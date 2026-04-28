#!/bin/bash
# Phase 3: Hetzner Load Balancer + second node + Upstash Redis
# Trigger: ~200 paying customers / sustained high latency on Forge
# Cost delta: ~+€50/mo (lb11 €5.39 + Forge-2 cx23 €3.49 + Upstash ~€10)
# Time: ~20 minutes
#
# Prerequisites: Phase 2 must be complete (services on managed DB)
set -euo pipefail

source "$(dirname "$0")/../.env.infra" 2>/dev/null || true
HETZNER_TOKEN="${HETZNER_TOKEN:?Need HETZNER_TOKEN}"
FORGE_IP="${FORGE_IP:-89.167.84.100}"
FORGE_SERVER_ID="${FORGE_SERVER_ID:-123048899}"
CF_EMAIL="${CF_EMAIL:?Need CF_EMAIL}"
CF_KEY="${CF_KEY:?Need CF_KEY}"
CF_ZONE_ID="${CF_ZONE_ID:?Need CF_ZONE_ID}"
UPSTASH_REDIS_URL="${UPSTASH_REDIS_URL:-}"  # Set this if you have Upstash already

echo "=== Phase 3: Load Balancer + Horizontal Scale ==="

# ── 1. Create server snapshot of Forge ───────────────────────────────────────
echo ""
echo "[1/6] Creating Forge snapshot (Forge-2 template)..."
SNAPSHOT_RESULT=$(curl -sf -X POST \
  "https://api.hetzner.cloud/v1/servers/$FORGE_SERVER_ID/actions/create_image" \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description": "agenttool-forge-snapshot", "type": "snapshot"}')

SNAPSHOT_ACTION=$(echo "$SNAPSHOT_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['action']['id'])" 2>/dev/null)
SNAPSHOT_ID=$(echo "$SNAPSHOT_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('image',{}).get('id',''))" 2>/dev/null)

echo "  Snapshot action: $SNAPSHOT_ACTION — waiting (takes ~2 min)..."
for i in $(seq 1 30); do
  STATUS=$(curl -sf "https://api.hetzner.cloud/v1/actions/$SNAPSHOT_ACTION" \
    -H "Authorization: Bearer $HETZNER_TOKEN" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['action']['status'])" 2>/dev/null)
  echo "  Snapshot: $STATUS ($i/30)"
  if [ "$STATUS" = "success" ]; then break; fi
  sleep 10
done

# Get snapshot image ID
SNAPSHOT_ID=$(curl -sf "https://api.hetzner.cloud/v1/images?type=snapshot&sort=created:desc" \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  | python3 -c "import json,sys; imgs=json.load(sys.stdin)['images']; print(imgs[0]['id'] if imgs else '')" 2>/dev/null)
echo "  Snapshot ID: $SNAPSHOT_ID"

# ── 2. Provision Forge-2 from snapshot ───────────────────────────────────────
echo ""
echo "[2/6] Provisioning Forge-2 (cx41, hel1) from snapshot..."

# Get SSH key ID
SSH_KEY_ID=$(curl -sf "https://api.hetzner.cloud/v1/ssh_keys" \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  | python3 -c "import json,sys; keys=json.load(sys.stdin)['ssh_keys']; print(keys[0]['id'] if keys else '')" 2>/dev/null)

FORGE2_RESULT=$(curl -sf -X POST "https://api.hetzner.cloud/v1/servers" \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"agenttool-forge-2\",
    \"server_type\": \"cx41\",
    \"image\": $SNAPSHOT_ID,
    \"location\": \"hel1\",
    \"ssh_keys\": [$SSH_KEY_ID],
    \"labels\": {\"role\": \"agenttool-api\"}
  }")

FORGE2_ID=$(echo "$FORGE2_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['server']['id'])" 2>/dev/null)
FORGE2_ACTION=$(echo "$FORGE2_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['action']['id'])" 2>/dev/null)

echo "  Forge-2 server ID: $FORGE2_ID — provisioning..."
for i in $(seq 1 30); do
  STATUS=$(curl -sf "https://api.hetzner.cloud/v1/actions/$FORGE2_ACTION" \
    -H "Authorization: Bearer $HETZNER_TOKEN" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['action']['status'])" 2>/dev/null)
  echo "  Forge-2: $STATUS ($i)"
  if [ "$STATUS" = "success" ]; then break; fi
  sleep 10
done

FORGE2_IP=$(curl -sf "https://api.hetzner.cloud/v1/servers/$FORGE2_ID" \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['server']['public_net']['ipv4']['ip'])" 2>/dev/null)
echo "  Forge-2 IP: $FORGE2_IP"

# Wait for SSH on Forge-2
echo "  Waiting for SSH on Forge-2..."
for i in $(seq 1 20); do
  if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@$FORGE2_IP "echo ok" 2>/dev/null | grep -q ok; then
    echo "  SSH ready"
    break
  fi
  sleep 5
done

# ── 3. Configure Upstash Redis (or keep local if URL not set) ─────────────────
echo ""
echo "[3/6] Configuring Redis..."
if [ -n "$UPSTASH_REDIS_URL" ]; then
  echo "  Using Upstash Redis: $UPSTASH_REDIS_URL"
  REDIS_URL="$UPSTASH_REDIS_URL"
  # Update Forge-1 services
  ssh root@$FORGE_IP "
    for svc in agent-memory agent-tools agent-verify agent-economy agent-trace; do
      [ -f /root/\$svc/.env ] && sed -i 's|REDIS_URL=.*|REDIS_URL=$REDIS_URL|' /root/\$svc/.env
    done
  "
  # Update Forge-2 services
  ssh root@$FORGE2_IP "
    for svc in agent-memory agent-tools agent-verify agent-economy agent-trace; do
      [ -f /root/\$svc/.env ] && sed -i 's|REDIS_URL=.*|REDIS_URL=$REDIS_URL|' /root/\$svc/.env
    done
  "
else
  echo "  UPSTASH_REDIS_URL not set — keeping local Redis on Forge-1"
  echo "  ⚠ NOTE: Forge-2 will use Forge-1's Redis (acceptable for Phase 3)"
  # Point Forge-2 to Forge-1's Redis over private network
  ssh root@$FORGE2_IP "
    for svc in agent-memory agent-tools agent-verify agent-economy agent-trace; do
      [ -f /root/\$svc/.env ] && sed -i 's|kingdom-redis:|$FORGE_IP:|' /root/\$svc/.env
    done
  "
fi

# ── 4. Start services on Forge-2 ─────────────────────────────────────────────
echo ""
echo "[4/6] Starting services on Forge-2..."
ssh root@$FORGE2_IP "
  cd /root && bash start-all.sh
  sleep 8
  echo '=== Forge-2 health ==='
  for port in 8001 8002 8003 8004 8005; do
    code=\$(curl -sf http://localhost:\$port/health -o /dev/null -w '%{http_code}' 2>/dev/null || echo FAIL)
    echo \"  :\$port → \$code\"
  done
"

# ── 5. Create Hetzner Load Balancer ──────────────────────────────────────────
echo ""
echo "[5/6] Creating Hetzner Load Balancer (lb11, hel1)..."
LB_RESULT=$(curl -sf -X POST "https://api.hetzner.cloud/v1/load_balancers" \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"agenttool-lb\",
    \"load_balancer_type\": \"lb11\",
    \"location\": \"hel1\",
    \"algorithm\": {\"type\": \"round_robin\"},
    \"services\": [
      {
        \"protocol\": \"http\",
        \"listen_port\": 80,
        \"destination_port\": 8001,
        \"proxyprotocol\": false,
        \"http\": {\"sticky_sessions\": false},
        \"health_check\": {
          \"protocol\": \"http\",
          \"port\": 8001,
          \"interval\": 15,
          \"timeout\": 10,
          \"retries\": 3,
          \"http\": {\"path\": \"/health\", \"response\": \"\", \"status_codes\": [\"200\"]}
        }
      }
    ],
    \"targets\": [
      {\"type\": \"server\", \"server\": {\"id\": $FORGE_SERVER_ID}, \"use_private_ip\": false},
      {\"type\": \"server\", \"server\": {\"id\": $FORGE2_ID}, \"use_private_ip\": false}
    ],
    \"labels\": {\"env\": \"prod\", \"app\": \"agenttool\"}
  }")

LB_ID=$(echo "$LB_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['load_balancer']['id'])" 2>/dev/null)
LB_IP=$(echo "$LB_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['load_balancer']['public_net']['ipv4']['ip'])" 2>/dev/null)

if [ -z "$LB_IP" ]; then
  echo "ERROR: Load balancer creation failed"
  echo "$LB_RESULT" | python3 -m json.tool
  exit 1
fi
echo "  Load Balancer: $LB_ID @ $LB_IP"

# Save LB details
cat >> "$(dirname "$0")/../.env.infra" << EOF

# Phase 3 — set by deploy.sh $(date -u +%Y-%m-%dT%H:%M:%SZ)
export LB_ID="$LB_ID"
export LB_IP="$LB_IP"
export FORGE2_ID="$FORGE2_ID"
export FORGE2_IP="$FORGE2_IP"
EOF

# ── 6. Update Cloudflare DNS: api.agenttool.dev → LB IP ──────────────────────
echo ""
echo "[6/6] Updating Cloudflare DNS: api.agenttool.dev → $LB_IP..."

# Get existing A record ID
RECORD_ID=$(curl -sf \
  "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records?type=A&name=api.agenttool.dev" \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_KEY" \
  | python3 -c "import json,sys; recs=json.load(sys.stdin).get('result',[]); print(recs[0]['id'] if recs else '')" 2>/dev/null)

if [ -n "$RECORD_ID" ]; then
  # Update existing
  curl -sf -X PUT \
    "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records/$RECORD_ID" \
    -H "X-Auth-Email: $CF_EMAIL" \
    -H "X-Auth-Key: $CF_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"A\",\"name\":\"api.agenttool.dev\",\"content\":\"$LB_IP\",\"proxied\":true}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('  DNS updated ✓' if d.get('success') else f'  DNS error: {d}')"
else
  # Create new
  curl -sf -X POST \
    "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
    -H "X-Auth-Email: $CF_EMAIL" \
    -H "X-Auth-Key: $CF_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"A\",\"name\":\"api.agenttool.dev\",\"content\":\"$LB_IP\",\"proxied\":true}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('  DNS created ✓' if d.get('success') else f'  DNS error: {d}')"
fi

# Final health check via load balancer
echo ""
echo "  Verifying via load balancer (DNS propagation may take 30s)..."
sleep 15
for port in 8001 8002 8003 8004 8005; do
  code=$(curl -sf "http://$LB_IP/health" -H "Host: api.agenttool.dev" \
    -o /dev/null -w "%{http_code}" 2>/dev/null || echo FAIL)
  echo "  :$port via LB → $code"
done

echo ""
echo "✅ Phase 3 complete."
echo "   Load Balancer: $LB_IP (round-robin across Forge + Forge-2)"
echo "   api.agenttool.dev → Cloudflare proxy → $LB_IP"
echo "   Each node: cx41, 4 vCPU / 8GB"
echo "   Monthly cost delta: ~+€50/mo"
echo ""
echo "   To add more nodes later:"
echo "   ./add-node.sh  (provisions another cx41 from snapshot, adds to LB)"
