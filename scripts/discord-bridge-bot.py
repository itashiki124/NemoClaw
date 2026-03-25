import discord
from discord import app_commands
import os
import re
import json
import shlex
import subprocess
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from collections import deque

intents = discord.Intents.default()
intents.message_content = True

# プロキシ設定 (HTTPS_PROXY / HTTP_PROXY 環境変数を参照)
PROXY_URL = os.getenv('HTTPS_PROXY') or os.getenv('HTTP_PROXY') or os.getenv('https_proxy') or os.getenv('http_proxy')

bot = discord.Client(intents=intents, proxy=PROXY_URL)
tree = app_commands.CommandTree(bot)

def parse_id_set(env_name):
    raw_value = os.getenv(env_name, '').strip()
    if not raw_value:
        return set()
    return {item.strip() for item in raw_value.split(',') if item.strip()}


ALLOWED_USER_IDS = parse_id_set('DISCORD_ALLOWED_USERS')
ALLOWED_CHANNEL_IDS = parse_id_set('DISCORD_ALLOWED_CHANNELS')
BOT_PREFIX = os.getenv('DISCORD_PREFIX', '!')
RESPOND_TO_ALL = os.getenv('DISCORD_RESPOND_TO_ALL', 'true').lower() in {'1', 'true', 'yes', 'on'}
OPENCLAW_TIMEOUT_SECONDS = int(os.getenv('OPENCLAW_TIMEOUT_SECONDS', '300'))
OPENCLAW_MAX_RETRIES = int(os.getenv('OPENCLAW_MAX_RETRIES', '2'))
SSH_CONNECT_TIMEOUT = int(os.getenv('SSH_CONNECT_TIMEOUT', '30'))
OPENCLAW_PROMPT_PREFIX = os.getenv(
    'OPENCLAW_PROMPT_PREFIX',
    'あなたは Discord で人間と会話している AI です。以下のルールを厳守してください。\n\n'
    '【絶対ルール】\n'
    '- 嘘をつかない。知らないことは「わからない」と正直に言う。\n'
    '- 実行できない約束はしない（「後で教えます」「○時に報告します」等は禁止）。\n'
    '- 自分が実際にやっていないことを「やった」と言わない。\n'
    '- 架空の体験談を作らない。AIであることを隠さなくていい。\n\n'
    '【会話スタイル】\n'
    '- 日本語で、友人と話すようにカジュアルに。\n'
    '- 短めに。1〜3文が目安。\n'
    '- 直近の会話履歴がある場合、文脈を踏まえて自然に応答する。\n'
    '- ユーザーの好みや特徴がわかったら memory/ や USER.md に書き残す。\n',
)
MAX_RESPONSE_CHARS = int(os.getenv('DISCORD_MAX_RESPONSE_CHARS', '1200'))
HISTORY_MAX_PER_CHANNEL = int(os.getenv('DISCORD_HISTORY_MAX', '20'))
HISTORY_FILE = Path(os.getenv('DISCORD_HISTORY_FILE', os.path.expanduser('~/.discord-bridge-history.json')))


# --- Conversation History Manager ---

class ConversationHistory:
    """チャンネルごとの会話履歴を管理する"""

    def __init__(self, path, max_per_channel=20):
        self._path = path
        self._max = max_per_channel
        self._data = {}  # channel_id -> deque of {role, user, content, ts}
        self._load()

    def _load(self):
        if self._path.exists():
            try:
                raw = json.loads(self._path.read_text(encoding='utf-8'))
                for ch_id, entries in raw.items():
                    self._data[ch_id] = deque(entries, maxlen=self._max)
            except (json.JSONDecodeError, KeyError):
                self._data = {}

    def _save(self):
        serializable = {ch: list(entries) for ch, entries in self._data.items()}
        tmp = self._path.with_suffix('.tmp')
        tmp.write_text(json.dumps(serializable, ensure_ascii=False, indent=1), encoding='utf-8')
        tmp.replace(self._path)

    def add(self, channel_id, role, content, user_name=None, user_id=None):
        ch = str(channel_id)
        if ch not in self._data:
            self._data[ch] = deque(maxlen=self._max)
        entry = {
            'role': role,
            'content': content,
            'ts': datetime.now(timezone.utc).isoformat(),
        }
        if user_name:
            entry['user'] = user_name
        if user_id:
            entry['user_id'] = str(user_id)
        self._data[ch].append(entry)
        self._save()

    def format_context(self, channel_id, last_n=10):
        ch = str(channel_id)
        entries = list(self._data.get(ch, []))[-last_n:]
        if not entries:
            return ''
        lines = []
        for e in entries:
            who = e.get('user', 'bot')
            lines.append(f"[{e.get('ts', '')}] {who}: {e['content']}")
        return '\n'.join(lines)


history = ConversationHistory(HISTORY_FILE, HISTORY_MAX_PER_CHANNEL)


def should_ignore_message(message):
    if message.author == bot.user:
        # ハートビート等の外部送信メッセージを履歴に含める
        # ただし on_message 応答で既に記録したものと重複しないようフラグで管理
        if message.content and message.channel:
            ch = str(message.channel.id)
            last = history._data.get(ch)
            # 直近の assistant 記録と同一内容なら重複スキップ
            if not (last and last[-1].get('role') == 'assistant'
                    and last[-1].get('content') == message.content):
                history.add(message.channel.id, 'assistant', message.content)
        return True
    if message.author.bot:
        return True
    if ALLOWED_USER_IDS and str(message.author.id) not in ALLOWED_USER_IDS:
        return True
    if ALLOWED_CHANNEL_IDS and str(message.channel.id) not in ALLOWED_CHANNEL_IDS:
        return True
    return False


def extract_user_message(message):
    if bot.user.mentioned_in(message) and not message.mention_everyone:
        return message.content.replace(f'<@{bot.user.id}>', '').replace(f'<@!{bot.user.id}>', '').strip()
    if message.content.startswith(BOT_PREFIX):
        return message.content[len(BOT_PREFIX):].strip()
    if RESPOND_TO_ALL and not message.content.startswith('/'):
        return message.content.strip()
    return ''


_ANSI_RE = re.compile(r'\x1b\[[0-9;]*[A-Za-z]')

def clean_response(output):
    # \r 除去 & ANSI エスケープ除去
    output = _ANSI_RE.sub('', output.replace('\r', ''))
    lines = output.split('\n')
    response_lines = []
    skip = True
    for line in lines:
        if skip and (
            line.startswith('[plugins]')
            or line.startswith('(node:')
            or line.startswith('(Use `node')
            or line.strip() == ''
        ):
            continue
        if line.startswith('Chat summary:'):
            break
        skip = False
        response_lines.append(line)
    # 連続する空行を1つにまとめる
    collapsed = []
    prev_blank = False
    for line in response_lines:
        if line.strip() == '':
            if prev_blank:
                continue
            prev_blank = True
        else:
            prev_blank = False
        collapsed.append(line)
    response = '\n'.join(collapsed).strip()
    # 単語途中の不自然な改行を除去（日本語文字間の孤立改行）
    response = re.sub(r'(?<=[\u3000-\u9fff\uff00-\uffef])\n(?=[\u3000-\u9fff\uff00-\uffef])', '', response)
    if len(response) > MAX_RESPONSE_CHARS:
        return response[:MAX_RESPONSE_CHARS].rstrip() + '...'
    return response


def run_openclaw(message_text, session_id='discord', channel_id=None, user_name=None):
    """SSH 経由で OpenClaw agent にメッセージを送信し、応答を返す"""
    # 会話履歴コンテキストを組み立て
    context_block = ''
    if channel_id:
        recent = history.format_context(channel_id, last_n=10)
        if recent:
            context_block = f'\n\n--- 直近の会話履歴 ---\n{recent}\n--- 履歴ここまで ---\n'

    user_tag = f'（発言者: {user_name}）\n' if user_name else ''
    prompt = f'{OPENCLAW_PROMPT_PREFIX}{context_block}\n{user_tag}ユーザーのメッセージ: {message_text}'
    remote_cmd = f'openclaw agent --agent main --local --session-id {shlex.quote(session_id)} -m {shlex.quote(prompt)}'
    cmd = [
        'ssh',
        '-o', f'ConnectTimeout={SSH_CONNECT_TIMEOUT}',
        '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=3',
        'openshell-my-assistant',
        remote_cmd,
    ]

    last_error = None
    for attempt in range(1, OPENCLAW_MAX_RETRIES + 1):
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=OPENCLAW_TIMEOUT_SECONDS,
                env={**os.environ, 'PATH': os.environ.get('PATH', '')}
            )
            response = clean_response(result.stdout.strip())
            if not response and result.stderr:
                err_msg = result.stderr[:300]
                # SSH 接続エラーはリトライ
                if 'Connection refused' in err_msg or 'Connection timed out' in err_msg:
                    last_error = err_msg
                    print(f"[retry {attempt}/{OPENCLAW_MAX_RETRIES}] SSH error: {err_msg}")
                    continue
                return f"Error: {err_msg}"
            return response if response else "(no response)"
        except subprocess.TimeoutExpired:
            last_error = "OpenClaw response timed out"
            print(f"[retry {attempt}/{OPENCLAW_MAX_RETRIES}] Timeout after {OPENCLAW_TIMEOUT_SECONDS}s")
            continue
        except Exception as e:
            return f"Error: {e}"

    return f"Error: {last_error} (after {OPENCLAW_MAX_RETRIES} attempts)"


@bot.event
async def on_ready():
    print(f'Logged in as {bot.user} (ID: {bot.user.id})')
    try:
        synced = await tree.sync()
        print(f"Synced {len(synced)} slash command(s)")
    except Exception as e:
        print(f"Failed to sync commands: {e}")


@bot.event
async def on_message(message):
    if should_ignore_message(message):
        return

    user_message = extract_user_message(message)

    if not user_message:
        return

    # 会話履歴にユーザーメッセージを記録
    display_name = message.author.display_name or message.author.name
    history.add(message.channel.id, 'user', user_message,
                user_name=display_name, user_id=message.author.id)

    async with message.channel.typing():
        session_id = f"discord-{message.channel.id}"
        response = await asyncio.to_thread(
            run_openclaw, user_message, session_id,
            channel_id=message.channel.id, user_name=display_name,
        )

    # Bot の応答も履歴に記録
    if response and not response.startswith('Error:'):
        history.add(message.channel.id, 'assistant', response)

    # Discord の 2000 文字制限に対応
    if len(response) <= 2000:
        await message.channel.send(response)
    else:
        chunks = [response[i:i+1990] for i in range(0, len(response), 1990)]
        for chunk in chunks:
            await message.channel.send(chunk)


@tree.command(name="ask", description="OpenClaw に質問する")
@app_commands.describe(question="OpenClaw に送る質問やタスク")
async def ask(interaction: discord.Interaction, question: str):
    await interaction.response.defer(thinking=True)
    display_name = interaction.user.display_name or interaction.user.name
    history.add(interaction.channel_id, 'user', question,
                user_name=display_name, user_id=interaction.user.id)
    session_id = f"discord-{interaction.channel_id}"
    response = await asyncio.to_thread(
        run_openclaw, question, session_id,
        channel_id=interaction.channel_id, user_name=display_name,
    )
    if response and not response.startswith('Error:'):
        history.add(interaction.channel_id, 'assistant', response)

    if len(response) <= 2000:
        await interaction.followup.send(response)
    else:
        chunks = [response[i:i+1990] for i in range(0, len(response), 1990)]
        for i, chunk in enumerate(chunks):
            if i == 0:
                await interaction.followup.send(chunk)
            else:
                await interaction.channel.send(chunk)


@tree.command(name="ping", description="Pong!")
async def ping(interaction: discord.Interaction):
    await interaction.response.send_message('Pong!')


bot.run(os.getenv('DISCORD_TOKEN'))
