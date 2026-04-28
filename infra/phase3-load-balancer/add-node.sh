#!/bin/bash
# Add a new node to the load balancer (run any time after Phase 3)
# One command to horizontally scale: ./add-node.sh
set -euo pipefail

source "$(dirname "$0")/../.env.infra" 2>/dev/null || true
HETZNER_TOKEN="${HETZNER_TOKEN:?Need HETZNER_TOKEN}"
LB_ID="${LB_ID:?Need LB_ID — run phase3/deploy.sh first}"

echo "=== Adding new node to load balancer ==="

# Get latest snapshot
SNAPSHOT_ID=$(curl -sf "https://api.hetzner.cloud/v1/images?type=snapshot&sort=created:desc" \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  | python3 -c "import json,sys; imgs=json.load(sys.stdin)['images']; print(imgs[0]['id'] if imgs else '')" 2>/dev/null)

NODE_NUM=$(date +%s)  # unique suffix
SSH_KEY_ID=$(curl -sf "https://api.hetzner.cloud/v1/ssh_keys" \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  | python3 -c "import json,sys; keys=json.load(sys.stdin)['ssh_keys']; print(keys[0]['id'] if keys else '')" 2>/dev/null)

echo "[1/3] Provisioning new node from snapshot $SNAPSHOT_ID..."
NODE_RESULT=$(curl -sf -X POST "https://api.hetzner.cloud/v1/servers" \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"agenttool-forge-$NODE_NUM\",
    \"server_type\": \"cx41\",
    \"image\": $SNAPSHOT_ID,
    \"location\": \"hel1\",
    \"ssh_keys\": [$SSH_KEY_ID],
    \"labels\": {\"role\": \"agenttool-api\"}
  }")

NODE_ID=$(echo "$NODE_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['server']['id'])" 2>/dev/null)
NODE_ACTION=$(echo "$NODE_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['action']['id'])" 2>/dev/null)

for i in $(seq 1 30); do
  STATUS=$(curl -sf "https://api.hetzner.cloud/v1/actions/$NODE_ACTION" \
    -H "Authorization: Bearer $HETZNER_TOKEN" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['action']['status'])" 2>/dev/null)
  if [ "$STATUS" = "success" ]; then break; fi
  sleep 10
done

NODE_IP=$(curl -sf "https://api.hetzner.cloud/v1/servers/$NODE_ID" \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['server']['public_net']['ipv4']['ip'])" 2>/dev/null)

# Wait for SSH + start services
echo "[2/3] Starting services on $NODE_IP..."
for i in $(seq 1 20); do
  if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@$NODE_IP "echo ok" 2>/dev/null | grep -q ok; then break; fi
  sleep 5
done
ssh root@$NODE_IP "cd /root && bash start-all.sh && sleep 5"

# Add to load balancer
echo "[3/3] Adding $NODE_IP to load balancer $LB_ID..."
curl -sf -X POST "https://api.hetzner.cloud/v1/load_balancers/$LB_ID/actions/add_target" \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\": \"server\", \"server\": {\"id\": $NODE_ID}, \"use_private_ip\": false}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('  Added ✓' if d.get('action') else f'  Error: {d}')"

echo ""
echo "✅ New node $NODE_IP (ID: $NODE_ID) added to load balancer."
echo "   Traffic is now distributed across $(curl -sf "https://api.hetzner.cloud/v1/load_balancers/$LB_ID" \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['load_balancer']['targets']))" 2>/dev/null) nodes."
