#!/bin/bash
# Patch CoreDNS to forward to Docker gateway instead of 127.0.0.11
CLUSTER="openshell-cluster-nemoclaw"
UPSTREAM="8.8.8.8 1.1.1.1"

COREFILE=".:53 {
    errors
    health
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
      pods insecure
      fallthrough in-addr.arpa ip6.arpa
    }
    hosts /etc/coredns/NodeHosts {
      ttl 60
      reload 15s
      fallthrough
    }
    prometheus :9153
    cache 30
    loop
    reload
    loadbalance
    forward . ${UPSTREAM}
}
"

# Create a JSON patch file inside the container
docker exec "$CLUSTER" sh -c "cat > /tmp/coredns-patch.json << 'PATCH'
{\"data\":{\"Corefile\":\".:53 {\\n    errors\\n    health\\n    ready\\n    kubernetes cluster.local in-addr.arpa ip6.arpa {\\n      pods insecure\\n      fallthrough in-addr.arpa ip6.arpa\\n    }\\n    hosts /etc/coredns/NodeHosts {\\n      ttl 60\\n      reload 15s\\n      fallthrough\\n    }\\n    prometheus :9153\\n    cache 30\\n    loop\\n    reload\\n    loadbalance\\n    forward . 8.8.8.8 1.1.1.1\\n}\\n\"}}
PATCH"

docker exec "$CLUSTER" kubectl patch configmap coredns -n kube-system --type merge -p "$(docker exec "$CLUSTER" cat /tmp/coredns-patch.json)"

echo "Restarting CoreDNS..."
docker exec "$CLUSTER" kubectl rollout restart deploy/coredns -n kube-system
docker exec "$CLUSTER" kubectl rollout status deploy/coredns -n kube-system --timeout=30s

echo "CoreDNS patched to forward to ${UPSTREAM}. DNS should resolve in ~10 seconds."
