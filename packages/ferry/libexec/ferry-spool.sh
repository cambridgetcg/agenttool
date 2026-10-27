#!/bin/sh
# ferry-spool.sh: the 渡 Ferry spool library, sourced by ferry-gate, ferry-hub
# and ferry-admin from the root-owned /Library/Ferry/libexec. It defines
# functions and constants only. Every byte it meets in the spool is treated as
# hostile data: names are grammar-checked, files are stat-checked before they
# are copied into a private stage, and only the copy is ever read.
# See ../CLAUDE.md for the principles and ../README.md for the contract.
set -euf

# --- ferry:paths (tests rewrite only this block) ---
FERRY_HOME=/Users/ferry
ROOT_OWNER=root
ROOT_GROUP=wheel
ID=/usr/bin/id
STAT=/usr/bin/stat
JQ=/usr/bin/jq
ICONV=/usr/bin/iconv
SHASUM=/usr/bin/shasum
XATTR=/usr/bin/xattr
# --- end ferry:paths ---

# Contract constants. They are part of the wire contract, so they are not
# tunable from site.conf. LOBBY_MAX matches the lobby CLI's packet cap.
LOBBY_MAX=65536
FILE_MAX=16777216
CMD_MAX=160
STALE_MIN=60
INFLIGHT_MAX=2
META_MAX=1024
LOG_ROLL=1048576
LOG_KEEP=4
ENROLL_FORMAT=agenttool-lobby-enrollment-packet/v1
JOIN_FORMAT=agenttool-lobby-join/v1
ENROLL_KEYS='["directory_token_sha256","display_name","enrollment_request","fingerprint","format","identity_id","issued_at","kind","origin","packet_sig","project_id","public_key","signing_key_id","valid_until"]'
JOIN_KEYS='["directory","door","format","invitation_template","origin","project_id"]'
# The only two jq filters Ferry uses (tests/static.test.ts checks this).
SHAPE_FILTER='type=="object" and .format==$f and (keys==$k)'
DISPLAY_FILTER='[.kind, .valid_until] | @tsv'

# ── start, stop, messages, log ────────────────────────────────────────

fs_begin() {
  FS_ROLE=none
  FS_ME=
  FS_LOCKED=0
  FS_TMP_A=
  FS_TMP_B=
  FS_TMP_C=
  FS_TMP_T=
  FS_LS=
  PEER=-
  CUR_OP=refuse
  CUR_ID=-
  CUR_TO=-
  CUR_BYTES=-
  CUR_ITEMS=-
  LOG=
  LOG_UMASK=077
  SPOOL=$FERRY_HOME/spool
  FS_START_DIR=$(pwd -P 2>/dev/null) || FS_START_DIR=/
  if [ "$FS_TOOL" = gate ]; then
    LOG=$FERRY_HOME/log/gate.log
    LOG_UMASK=027
  fi
  trap 'fs__exit $?' EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

fs__exit() {
  set +e
  if [ "$FS_LOCKED" = 1 ]; then
    rmdir "$SPOOL/.lock" 2>/dev/null
  fi
  for _ex_t in "$FS_TMP_A" "$FS_TMP_B" "$FS_TMP_C" "$FS_TMP_T"; do
    if [ -n "$_ex_t" ]; then
      rm -rf -- "$_ex_t" 2>/dev/null
    fi
  done
  fs__log "$CUR_OP" "$1" "$CUR_ID" "$CUR_TO" "$CUR_BYTES" "$CUR_ITEMS"
  exit "$1"
}

fs_die() {
  printf 'ferry-%s: %s: %s\n' "$FS_TOOL" "$2" "$3" >&2
  exit "$1"
}

# fs__log OP CODE ID TO BYTES ITEMS: one line of counts and ids, never names,
# packet fields, addresses or command text. The log rolls at LOG_ROLL bytes
# and keeps LOG_KEEP older generations (.1 newest), so a burst of cheap calls
# from one lane takes longer to push older lines out. The log belongs to the
# account that writes it: a record, not tamper-evident evidence.
fs__log() {
  if [ -z "$LOG" ] || [ -L "$LOG" ] || [ ! -d "${LOG%/*}" ]; then
    return 0
  fi
  if fs_stat "$LOG" && [ "$ST_TYPE" = "Regular File" ] && [ "$ST_SIZE" -ge "$LOG_ROLL" ]; then
    _lg_g=$LOG_KEEP
    while [ "$_lg_g" -gt 1 ]; do
      _lg_p=$((_lg_g - 1))
      if [ -f "$LOG.$_lg_p" ] && [ ! -L "$LOG.$_lg_p" ]; then
        rm -f -- "$LOG.$_lg_g" 2>/dev/null || :
        mv -f -- "$LOG.$_lg_p" "$LOG.$_lg_g" 2>/dev/null || :
      fi
      _lg_g=$_lg_p
    done
    rm -f -- "$LOG.1" 2>/dev/null || :
    mv -f -- "$LOG" "$LOG.1" 2>/dev/null || :
  fi
  if [ ! -e "$LOG" ]; then
    (umask "$LOG_UMASK"; : >> "$LOG") 2>/dev/null || return 0
  fi
  printf '%s %s peer=%s op=%s code=%s id=%s to=%s bytes=%s items=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$FS_TOOL" "$PEER" "$1" "$2" "$3" "$4" "$5" "$6" >> "$LOG" 2>/dev/null || :
  return 0
}

# ── grammar predicates (return 0 or 1, never exit) ─────────────────────

fs_is_peer() {
  case $1 in
    [a-z]*) ;;
    *) return 1 ;;
  esac
  case $1 in
    *[!a-z0-9-]* | *--* | *-) return 1 ;;
  esac
  [ ${#1} -ge 2 ] && [ ${#1} -le 16 ] || return 1
  return 0
}

fs_is_reserved() {
  case $1 in
    hub | ferry | all | none) return 0 ;;
  esac
  return 1
}

fs_is_id() {
  case $1 in
    [0-9][0-9][0-9][0-9][0-1][0-9][0-3][0-9]T[0-2][0-9][0-5][0-9][0-6][0-9]Z-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) return 0 ;;
  esac
  return 1
}

fs_is_name() {
  case $1 in
    [A-Za-z0-9]*) ;;
    *) return 1 ;;
  esac
  case $1 in
    *[!A-Za-z0-9._-]* | *..* | *.part | *.meta | *.body) return 1 ;;
  esac
  [ ${#1} -le 100 ] || return 1
  return 0
}

fs_is_sha() {
  case $1 in
    *[!0-9a-f]*) return 1 ;;
  esac
  [ ${#1} -eq 64 ] || return 1
  return 0
}

fs_is_num() {
  case $1 in
    '' | *[!0-9]*) return 1 ;;
    0) return 0 ;;
    0*) return 1 ;;
  esac
  [ ${#1} -le 12 ] || return 1
  return 0
}

fs_is_account() {
  case $1 in
    [a-z_]*) ;;
    *) return 1 ;;
  esac
  case $1 in
    *[!a-z0-9_-]*) return 1 ;;
  esac
  [ ${#1} -le 32 ] || return 1
  return 0
}

fs_is_abspath() {
  case $1 in
    /*) ;;
    *) return 1 ;;
  esac
  case $1 in
    *[!A-Za-z0-9/._-]* | *..*) return 1 ;;
  esac
  [ ${#1} -le 200 ] || return 1
  return 0
}

fs_is_ipv4() {
  case $1 in
    *[!0-9.]* | .* | *. | *..*) return 1 ;;
  esac
  _ip_ifs=$IFS
  IFS=.
  set -- $1
  IFS=$_ip_ifs
  [ $# -eq 4 ] || return 1
  for _ip_o in "$@"; do
    case $_ip_o in
      [0-9] | [1-9][0-9] | 1[0-9][0-9] | 2[0-4][0-9] | 25[0-5]) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

fs_is_cidr() {
  case $1 in
    */*) ;;
    *) return 1 ;;
  esac
  fs_is_ipv4 "${1%/*}" || return 1
  case ${1#*/} in
    [89] | [12][0-9] | 3[0-2]) return 0 ;;
  esac
  return 1
}

# ── stat, site, role ───────────────────────────────────────────────────

# fs_stat PATH: lstat into ST_TYPE ST_USER ST_GROUP ST_MODE ST_LINKS ST_SIZE
# ST_DEV ST_MTIME. All ownership and mode checks go through this one call.
fs_stat() {
  _st_o=$("$STAT" -f '%HT|%Su|%Sg|%Mp%Lp|%l|%z|%d|%m' -- "$1" 2>/dev/null) || return 1
  _st_ifs=$IFS
  IFS='|'
  set -- $_st_o
  IFS=$_st_ifs
  [ $# -eq 8 ] || return 1
  ST_TYPE=$1
  ST_USER=$2
  ST_GROUP=$3
  ST_MODE=$4
  ST_LINKS=$5
  ST_SIZE=$6
  ST_DEV=$7
  ST_MTIME=$8
  return 0
}

fs__kv() {
  case $2 in
    "$1="*) _SV=${2#"$1="}; return 0 ;;
  esac
  return 1
}

# fs_load_site: parse (never source) the root-owned site.conf. Every key
# appears once, in order; any deviation exits 6.
fs_load_site() {
  SITE_CONF=$FERRY_ROOT/site.conf
  fs_stat "$SITE_CONF" || fs_die 6 unsafe "site.conf is missing"
  if [ "$ST_TYPE" != "Regular File" ] || [ "$ST_USER" != "$ROOT_OWNER" ] || [ "$ST_GROUP" != "$ROOT_GROUP" ] \
    || [ "$ST_MODE" != 0644 ] || [ "$ST_LINKS" != 1 ] || [ "$ST_SIZE" -gt 4096 ]; then
    fs_die 6 unsafe "site.conf has the wrong type, owner or mode"
  fi
  _sl_i=0
  _sl_bad=0
  _sl_l=
  while IFS= read -r _sl_l; do
    _sl_i=$((_sl_i + 1))
    case $_sl_i in
      1) [ "$_sl_l" = ferry-site/1 ] || _sl_bad=1 ;;
      2) fs__kv ferry_user "$_sl_l" && fs_is_account "$_SV" && SITE_FERRY_USER=$_SV || _sl_bad=1 ;;
      3) fs__kv ferry_group "$_sl_l" && fs_is_account "$_SV" && SITE_FERRY_GROUP=$_SV || _sl_bad=1 ;;
      4) fs__kv hub_user "$_sl_l" && fs_is_account "$_SV" && SITE_HUB_USER=$_SV || _sl_bad=1 ;;
      5) fs__kv hub_home "$_sl_l" && fs_is_abspath "$_SV" && SITE_HUB_HOME=$_SV || _sl_bad=1 ;;
      6) fs__kv local_peer "$_sl_l" && fs_is_peer "$_SV" && SITE_LOCAL_PEER=$_SV || _sl_bad=1 ;;
      7) fs__kv lan_cidr "$_sl_l" && fs_is_cidr "$_SV" && SITE_LAN_CIDR=$_SV || _sl_bad=1 ;;
      8) fs__kv lobby_queue "$_sl_l" && fs_is_num "$_SV" && SITE_LOBBY_QUEUE=$_SV || _sl_bad=1 ;;
      9) fs__kv file_queue_items "$_sl_l" && fs_is_num "$_SV" && SITE_FILE_QUEUE_ITEMS=$_SV || _sl_bad=1 ;;
      10) fs__kv file_queue_bytes "$_sl_l" && fs_is_num "$_SV" && SITE_FILE_QUEUE_BYTES=$_SV || _sl_bad=1 ;;
      11) fs__kv spool_max_bytes "$_sl_l" && fs_is_num "$_SV" && SITE_SPOOL_MAX_BYTES=$_SV || _sl_bad=1 ;;
      12) fs__kv floor_kib "$_sl_l" && fs_is_num "$_SV" && SITE_FLOOR_KIB=$_SV || _sl_bad=1 ;;
      13) fs__kv retain_days "$_sl_l" && fs_is_num "$_SV" && SITE_RETAIN_DAYS=$_SV || _sl_bad=1 ;;
      *) _sl_bad=1 ;;
    esac
  done < "$SITE_CONF"
  if [ "$_sl_bad" != 0 ] || [ "$_sl_i" != 13 ] || [ -n "$_sl_l" ]; then
    fs_die 6 unsafe "site.conf is malformed"
  fi
  if fs_is_reserved "$SITE_LOCAL_PEER"; then
    fs_die 6 unsafe "site.conf names a reserved local peer"
  fi
  SPOOL=$FERRY_HOME/spool
  FERRY_STAGE=$FERRY_HOME/stage
  FERRY_LOG=$FERRY_HOME/log/gate.log
  AUTH_KEYS=$FERRY_HOME/.ssh/authorized_keys
  HUB_STATE=$SITE_HUB_HOME/.local/state/agenttool/ferry-hub
  HUB_STAGE=$HUB_STATE/stage
  HUB_LOG=$HUB_STATE/hub.log
  LOBBY_MAIL=$SITE_HUB_HOME/agenttool/state/lobby-mail
  LOBBY_CMD=$SITE_HUB_HOME/agenttool/bin/agenttool-lobby-fleet
  LANDING=$SITE_HUB_HOME/Ferry/inbox
  return 0
}

# fs_role gate|hub: refuse unless this is the matching account; choose the
# private stage and the log for the role.
fs_role() {
  FS_ME=$("$ID" -un 2>/dev/null) || fs_die 1 refused "cannot tell which account this is"
  case $1 in
    gate)
      [ "$FS_ME" = "$SITE_FERRY_USER" ] || fs_die 1 refused "this runs only as the ferry account"
      STAGE=$FERRY_STAGE
      LOG=$FERRY_LOG
      LOG_UMASK=027
      ;;
    hub)
      [ "$FS_ME" = "$SITE_HUB_USER" ] || fs_die 1 refused "this runs only as the hub user"
      STAGE=$HUB_STAGE
      LOG=$HUB_LOG
      LOG_UMASK=077
      PEER=$SITE_LOCAL_PEER
      ;;
    *) fs_die 2 usage "unknown role" ;;
  esac
  FS_ROLE=$1
  return 0
}

# ── directory and item checks ──────────────────────────────────────────

fs_dir_ok() {
  fs_stat "$1" || return 1
  [ "$ST_TYPE" = Directory ] && [ "$ST_USER" = "$SITE_FERRY_USER" ] \
    && [ "$ST_GROUP" = "$SITE_FERRY_GROUP" ] && [ "$ST_MODE" = 2770 ] || return 1
  return 0
}

fs_check_dir() {
  fs_dir_ok "$1" || fs_die 6 unsafe "a spool directory is missing or has the wrong type, owner or mode"
  return 0
}

# fs_enter DIR: make DIR the working directory, refusing if any component of
# its path is a link or DIR fails the spool directory checks. Every write or
# delete in the spool then names "./<entry>", so swapping a path for a link
# after the check (the ferry account can rename entries in the spool) cannot
# steer the hub user or root onto another directory.
fs_enter() {
  cd -P -- "$1" 2>/dev/null || return 1
  if [ "$(pwd -P)" != "$1" ] || ! fs_dir_ok .; then
    fs_leave
    return 1
  fi
  return 0
}

fs_leave() {
  cd -- "$FS_START_DIR" 2>/dev/null || cd /
  return 0
}

# fs_check_item_file PATH MAX: a regular file, not a link, one link, owned by
# the ferry or hub user, group ferry_group, mode exactly 0640, at most MAX.
fs_check_item_file() {
  fs_stat "$1" || return 1
  [ "$ST_TYPE" = "Regular File" ] && [ "$ST_LINKS" = 1 ] && [ "$ST_GROUP" = "$SITE_FERRY_GROUP" ] \
    && [ "$ST_MODE" = 0640 ] && [ "$ST_SIZE" -le "$2" ] || return 1
  [ "$ST_USER" = "$SITE_FERRY_USER" ] || [ "$ST_USER" = "$SITE_HUB_USER" ] || return 1
  return 0
}

# fs_check_spool: the spool tree and this role's private stage, on one volume.
fs_check_spool() {
  if [ "$FS_ROLE" = hub ]; then
    if ! fs_stat "$SPOOL" || [ ! -x "$SPOOL" ] || [ ! -w "$SPOOL" ]; then
      fs_die 6 unsafe "the spool is not reachable from this session; open a new terminal (or log out and in) after ferry-setup"
    fi
    if [ ! -e "$STAGE" ] && [ ! -L "$STAGE" ]; then
      (umask 077; mkdir -p -- "$STAGE") || fs_die 6 unsafe "could not create the hub stage"
    fi
  fi
  for _cs_d in "$SPOOL" "$SPOOL/lobby" "$SPOOL/lobby/in" "$SPOOL/lobby/out" "$SPOOL/files"; do
    fs_check_dir "$_cs_d"
  done
  fs_stat "$STAGE" || fs_die 6 unsafe "the stage directory is missing"
  if [ "$ST_TYPE" != Directory ] || [ "$ST_USER" != "$FS_ME" ] || [ "$ST_MODE" != 0700 ]; then
    fs_die 6 unsafe "the stage directory has the wrong type, owner or mode"
  fi
  _cs_dev=$ST_DEV
  fs_stat "$SPOOL" || fs_die 6 unsafe "the spool is missing"
  [ "$ST_DEV" = "$_cs_dev" ] || fs_die 6 unsafe "the stage and the spool are on different volumes"
  return 0
}

# fs_peer_dir lobby-in|lobby-out|files PEER: sets PEER_DIR after checks.
fs_peer_dir() {
  case $1 in
    lobby-in) PEER_DIR=$SPOOL/lobby/in/$2 ;;
    lobby-out) PEER_DIR=$SPOOL/lobby/out/$2 ;;
    files) PEER_DIR=$SPOOL/files/$2 ;;
    *) fs_die 2 usage "unknown spool area" ;;
  esac
  if [ ! -e "$PEER_DIR" ] && [ ! -L "$PEER_DIR" ]; then
    if [ "$1" = files ]; then
      fs_die 3 notfound "no such recipient at the post office"
    fi
    fs_die 1 refused "this lane is not provisioned"
  fi
  fs_check_dir "$PEER_DIR"
  return 0
}

# fs_ls DIR: the names in DIR, one per line, in FS_LS.
fs_ls() {
  FS_LS=$(ls -1A -- "$1" 2>/dev/null) || fs_die 6 unsafe "a spool directory could not be listed"
  return 0
}

fs_count_metas() {
  fs_ls "$1"
  CNT=0
  while IFS= read -r _cm_n; do
    case $_cm_n in
      *.meta) fs_is_id "${_cm_n%.meta}" && CNT=$((CNT + 1)) ;;
    esac
  done <<EOF
$FS_LS
EOF
  return 0
}

# ── meta files ─────────────────────────────────────────────────────────

fs__parse_meta() {
  M_KIND=
  M_FROM=
  M_TO=
  M_SIZE=
  M_SHA=
  M_NAME=
  _pm_i=0
  _pm_l=
  while IFS= read -r _pm_l; do
    _pm_i=$((_pm_i + 1))
    case $_pm_i in
      1) [ "$_pm_l" = ferry-meta/1 ] || return 1 ;;
      2)
        case $_pm_l in
          kind=lobby-enroll | kind=lobby-join | kind=file) M_KIND=${_pm_l#kind=} ;;
          *) return 1 ;;
        esac
        ;;
      3)
        fs__kv from "$_pm_l" || return 1
        M_FROM=$_SV
        [ "$M_FROM" = hub ] || fs_is_peer "$M_FROM" || return 1
        ;;
      4)
        fs__kv to "$_pm_l" || return 1
        M_TO=$_SV
        [ "$M_TO" = hub ] || fs_is_peer "$M_TO" || return 1
        ;;
      5) fs__kv size "$_pm_l" && fs_is_num "$_SV" || return 1; M_SIZE=$_SV ;;
      6) fs__kv sha256 "$_pm_l" && fs_is_sha "$_SV" || return 1; M_SHA=$_SV ;;
      7)
        [ "$M_KIND" = file ] || return 1
        fs__kv name "$_pm_l" && fs_is_name "$_SV" || return 1
        M_NAME=$_SV
        ;;
      *) return 1 ;;
    esac
  done < "$1"
  [ -z "$_pm_l" ] || return 1
  if [ "$M_KIND" = file ]; then
    [ "$_pm_i" -eq 7 ] || return 1
  else
    [ "$_pm_i" -eq 6 ] || return 1
  fi
  return 0
}

# fs_meta_of PATH: check the meta in place, copy it (cp -R -P neither follows
# a link nor reads a FIFO) into the stage, check the copy, parse the copy.
fs_meta_of() {
  fs_check_item_file "$1" "$META_MAX" || return 1
  _mo_t=$(mktemp "$STAGE/.meta.XXXXXXXX" 2>/dev/null) || return 1
  FS_TMP_C=$_mo_t
  rm -f -- "$_mo_t"
  _mo_rc=1
  if cp -R -P -- "$1" "$_mo_t" 2>/dev/null && fs_stat "$_mo_t" && [ "$ST_TYPE" = "Regular File" ] \
    && [ "$ST_LINKS" = 1 ] && [ "$ST_SIZE" -le "$META_MAX" ]; then
    if fs__parse_meta "$_mo_t"; then
      _mo_rc=0
    fi
  fi
  rm -rf -- "$_mo_t" 2>/dev/null || :
  FS_TMP_C=
  return "$_mo_rc"
}

# fs_write_meta KIND FROM TO SIZE SHA [NAME]: a staged meta in META_FILE.
fs_write_meta() {
  META_FILE=$(mktemp "$STAGE/.pmeta.$PEER.XXXXXXXX") || fs_die 6 unsafe "could not stage"
  FS_TMP_B=$META_FILE
  {
    printf 'ferry-meta/1\n'
    printf 'kind=%s\n' "$1"
    printf 'from=%s\n' "$2"
    printf 'to=%s\n' "$3"
    printf 'size=%s\n' "$4"
    printf 'sha256=%s\n' "$5"
    if [ "$1" = file ]; then
      printf 'name=%s\n' "$6"
    fi
  } > "$META_FILE" || fs_die 6 unsafe "could not stage"
  return 0
}

# fs_item_ok DIR ROLE PEER ID: the meta parses, agrees with the directory it
# is in, and the body passes the file checks at the meta's size.
fs_item_ok() {
  fs_meta_of "$1/$4.meta" || return 1
  case $2 in
    lobby-in)
      [ "$M_KIND" = lobby-enroll ] && [ "$M_FROM" = "$3" ] && [ "$M_TO" = hub ] || return 1
      _io_max=$LOBBY_MAX
      ;;
    lobby-out)
      [ "$M_KIND" = lobby-join ] && [ "$M_FROM" = hub ] && [ "$M_TO" = "$3" ] || return 1
      _io_max=$LOBBY_MAX
      ;;
    files)
      [ "$M_KIND" = file ] && [ "$M_TO" = "$3" ] && [ "$M_FROM" != hub ] && [ "$M_FROM" != "$3" ] || return 1
      _io_max=$FILE_MAX
      ;;
    *) return 1 ;;
  esac
  [ "$M_SIZE" -ge 1 ] && [ "$M_SIZE" -le "$_io_max" ] || return 1
  fs_check_item_file "$1/$4.body" "$_io_max" || return 1
  [ "$ST_SIZE" = "$M_SIZE" ] || return 1
  return 0
}

# fs_sha FILE: SHA (64 lowercase hex) of a staged file.
fs_sha() {
  _sh_o=$("$SHASUM" -a 256 < "$1" 2>/dev/null) || return 1
  SHA=${_sh_o%% *}
  fs_is_sha "$SHA" || return 1
  return 0
}

# fs_take DIR ROLE PEER ID: a verified private copy of the body in TAKE_FILE.
# A spool path is never read directly; only the checked copy is. In the gate
# a copy counts against the lane's in-flight limit, as an upload does: a
# reader that stalls keeps its copy until the connection closes, so the
# number of copies a lane can hold must be bounded.
fs_take() {
  fs_item_ok "$@" || return 1
  _tk_t=$(mktemp "$STAGE/.take.$PEER.XXXXXXXX" 2>/dev/null) || return 1
  FS_TMP_T=$_tk_t
  if [ "$FS_ROLE" = gate ]; then
    fs__inflight
  fi
  rm -f -- "$_tk_t"
  if cp -R -P -- "$1/$4.body" "$_tk_t" 2>/dev/null && fs_stat "$_tk_t" && [ "$ST_TYPE" = "Regular File" ] \
    && [ "$ST_LINKS" = 1 ] && [ "$ST_SIZE" = "$M_SIZE" ] && fs_sha "$_tk_t" && [ "$SHA" = "$M_SHA" ]; then
    TAKE_FILE=$_tk_t
    return 0
  fi
  rm -rf -- "$_tk_t" 2>/dev/null || :
  FS_TMP_T=
  return 1
}

fs_drop_take() {
  rm -f -- "$TAKE_FILE" 2>/dev/null || :
  FS_TMP_T=
  TAKE_FILE=
  return 0
}

# ── receiving, room, publishing ────────────────────────────────────────

fs_avail_kib() {
  _df_o=$(df -P -k "$SPOOL" 2>/dev/null) || fs_die 6 unsafe "could not read free space"
  _df_l=$(printf '%s\n' "$_df_o" | tail -n 1)
  set -- $_df_l
  [ $# -ge 4 ] && fs_is_num "$4" || fs_die 6 unsafe "could not read free space"
  AVAIL_KIB=$4
  return 0
}

fs_floor_precheck() {
  fs_avail_kib
  [ $((AVAIL_KIB - $1 / 1024)) -ge "$SITE_FLOOR_KIB" ] || fs_die 5 full "the post office disk is nearly full"
  return 0
}

# fs__inflight: exit 5 when this lane already has INFLIGHT_MAX transfers
# staged (uploads .part.<peer>.*, gets .take.<peer>.*), counting the caller's
# own staged file, which must exist already.
fs__inflight() {
  fs_ls "$STAGE"
  _if_n=0
  while IFS= read -r _if_x; do
    case $_if_x in
      ".part.$PEER."* | ".take.$PEER."*) _if_n=$((_if_n + 1)) ;;
    esac
  done <<EOF
$FS_LS
EOF
  [ "$_if_n" -le "$INFLIGHT_MAX" ] || fs_die 5 full "too many transfers in flight on this lane"
  return 0
}

# fs_size_ok SIZE MAX: the size a sender declared, as a word of the command.
# Not a number is a grammar error (2); 0 or over MAX is invalid content (4).
fs_size_ok() {
  fs_is_num "$1" || fs_die 2 usage "not a ferry command"
  [ "$1" -ge 1 ] || fs_die 4 invalid "the upload is empty"
  [ "$1" -le "$2" ] || fs_die 4 invalid "the upload is over the size limit"
  return 0
}

# fs_receive SIZE: exactly SIZE bytes of stdin (SIZE already passed
# fs_size_ok) into a private staged file (RCV_FILE, RCV_SIZE). The sender
# declares SIZE in its command because the gate cannot otherwise tell an
# upload cut short (a Ctrl-C or a dropped connection closes stdin early) from
# a whole one; a short or a long stream is refused and nothing is published.
fs_receive() {
  RCV_FILE=$(mktemp "$STAGE/.part.$PEER.XXXXXXXX" 2>/dev/null) || fs_die 6 unsafe "could not stage"
  FS_TMP_A=$RCV_FILE
  fs__inflight
  head -c $(($1 + 1)) > "$RCV_FILE" || fs_die 4 invalid "the upload could not be received"
  fs_stat "$RCV_FILE" || fs_die 6 unsafe "could not stage"
  [ "$ST_SIZE" -gt 0 ] || fs_die 4 invalid "the upload is empty"
  [ "$ST_SIZE" -le "$1" ] || fs_die 4 invalid "the upload is longer than its declared size"
  [ "$ST_SIZE" = "$1" ] || fs_die 4 invalid "the upload ended before its declared size; nothing was kept"
  RCV_SIZE=$ST_SIZE
  return 0
}

# fs_tally FROM: TALLY_TOTAL (every valid meta's size in the spool) and
# TALLY_N / TALLY_BYTES (files waiting from FROM, in every files/ directory).
fs_tally() {
  TALLY_TOTAL=0
  TALLY_N=0
  TALLY_BYTES=0
  for _tl_area in lobby/in lobby/out files; do
    fs_ls "$SPOOL/$_tl_area"
    _tl_peers=$FS_LS
    while IFS= read -r _tl_p; do
      [ -n "$_tl_p" ] || continue
      fs_is_peer "$_tl_p" || continue
      fs_dir_ok "$SPOOL/$_tl_area/$_tl_p" || continue
      fs_ls "$SPOOL/$_tl_area/$_tl_p"
      while IFS= read -r _tl_n; do
        case $_tl_n in
          *.meta) ;;
          *) continue ;;
        esac
        fs_is_id "${_tl_n%.meta}" || continue
        fs_meta_of "$SPOOL/$_tl_area/$_tl_p/$_tl_n" || continue
        TALLY_TOTAL=$((TALLY_TOTAL + M_SIZE))
        if [ "$_tl_area" = files ] && [ "$M_FROM" = "$1" ]; then
          TALLY_N=$((TALLY_N + 1))
          TALLY_BYTES=$((TALLY_BYTES + M_SIZE))
        fi
      done <<EOF
$FS_LS
EOF
    done <<EOF
$_tl_peers
EOF
  done
  return 0
}

# fs_room KIND FROM SIZE DIR: quotas, the spool cap and the disk floor.
fs_room() {
  case $1 in
    lobby-enroll | lobby-join)
      fs_count_metas "$4"
      [ "$CNT" -lt "$SITE_LOBBY_QUEUE" ] || fs_die 5 full "this lane's lobby queue is full"
      ;;
  esac
  fs_tally "$2"
  if [ "$1" = file ]; then
    [ $((TALLY_N + 1)) -le "$SITE_FILE_QUEUE_ITEMS" ] || fs_die 5 full "this sender has too many files waiting"
    [ $((TALLY_BYTES + $3)) -le "$SITE_FILE_QUEUE_BYTES" ] || fs_die 5 full "this sender has too many bytes waiting"
  fi
  [ $((TALLY_TOTAL + $3)) -le "$SITE_SPOOL_MAX_BYTES" ] || fs_die 5 full "the spool is full"
  fs_avail_kib
  [ $((AVAIL_KIB - ($3 + 1023) / 1024)) -ge "$SITE_FLOOR_KIB" ] || fs_die 5 full "the post office disk is nearly full"
  return 0
}

fs_new_id() {
  _ni_t=$(date -u +%Y%m%dT%H%M%SZ) || fs_die 6 unsafe "could not make an item id"
  _ni_r=$(od -An -N4 -tx1 /dev/urandom | tr -d ' \t\n') || fs_die 6 unsafe "could not make an item id"
  NEW_ID=$_ni_t-$_ni_r
  fs_is_id "$NEW_ID" || fs_die 6 unsafe "could not make an item id"
  return 0
}

fs_lock() {
  _lk_n=0
  _lk_broke=0
  while :; do
    if mkdir "$SPOOL/.lock" 2>/dev/null; then
      FS_LOCKED=1
      return 0
    fi
    if [ "$_lk_broke" = 0 ] && fs_stat "$SPOOL/.lock" && [ $(($(date +%s) - ST_MTIME)) -gt 60 ]; then
      rm -rf -- "$SPOOL/.lock" 2>/dev/null || :
      _lk_broke=1
      continue
    fi
    _lk_n=$((_lk_n + 1))
    [ "$_lk_n" -lt 50 ] || fs_die 1 busy "the spool is busy; try again"
    sleep 0.1
  done
}

fs_unlock() {
  rmdir "$SPOOL/.lock" 2>/dev/null || :
  FS_LOCKED=0
  return 0
}

# fs_publish DIR KIND FROM SIZE: move RCV_FILE then META_FILE into DIR under
# the lock, as <id>.body then <id>.meta. Sets PUB_ID.
fs_publish() {
  chgrp "$SITE_FERRY_GROUP" "$RCV_FILE" "$META_FILE" 2>/dev/null || fs_die 6 unsafe "could not set the hand-off group"
  chmod 0640 "$RCV_FILE" "$META_FILE" 2>/dev/null || fs_die 6 unsafe "could not set the item mode"
  fs_stat "$STAGE" || fs_die 6 unsafe "the stage directory is missing"
  _pb_dev=$ST_DEV
  fs_stat "$1" || fs_die 6 unsafe "a spool directory is missing"
  [ "$ST_DEV" = "$_pb_dev" ] || fs_die 6 unsafe "the stage and the spool are on different volumes"
  fs_lock
  fs_room "$2" "$3" "$4" "$1"
  fs_new_id
  fs_enter "$1" || fs_die 6 unsafe "a spool directory is missing or has the wrong type, owner or mode"
  for _pb_x in "./$NEW_ID.body" "./$NEW_ID.meta"; do
    if [ -e "$_pb_x" ] || [ -L "$_pb_x" ]; then
      fs_die 1 busy "item id clash; try again"
    fi
  done
  mv -- "$RCV_FILE" "./$NEW_ID.body" || fs_die 6 unsafe "could not publish"
  FS_TMP_A=
  mv -- "$META_FILE" "./$NEW_ID.meta" || fs_die 6 unsafe "could not publish"
  FS_TMP_B=
  fs_leave
  fs_unlock
  PUB_ID=$NEW_ID
  CUR_ID=$NEW_ID
  return 0
}

fs_remove() {
  fs_lock
  fs_enter "$1" || fs_die 6 unsafe "a spool directory is missing or has the wrong type, owner or mode"
  rm -f -- "./$2.meta" 2>/dev/null || :
  rm -f -- "./$2.body" 2>/dev/null || :
  fs_leave
  fs_unlock
  return 0
}

# fs_find_out PEER ID: the directory holding ID for PEER's lane, outbound
# side (lobby/out then files), into FOUND_DIR and FOUND_ROLE; exit 3 if none.
fs_find_out() {
  for _fo_r in lobby-out files; do
    case $_fo_r in
      lobby-out) _fo_d=$SPOOL/lobby/out/$1 ;;
      files) _fo_d=$SPOOL/files/$1 ;;
    esac
    if [ -e "$_fo_d/$2.meta" ] || [ -L "$_fo_d/$2.meta" ]; then
      FOUND_DIR=$_fo_d
      FOUND_ROLE=$_fo_r
      return 0
    fi
  done
  fs_die 3 notfound "no such item on this lane"
}

# fs_list_dir DIR ROLE PEER: one "item" line per item whose meta parses and
# whose body passes the file checks at the meta's size; LIST_N counts. It
# copies no body: the sha256 is checked on the copy a get takes, and the
# receiver checks it again.
fs_list_dir() {
  _ld_d=$1
  _ld_r=$2
  _ld_p=$3
  fs_ls "$_ld_d"
  while IFS= read -r _ld_n; do
    case $_ld_n in
      *.meta) ;;
      *) continue ;;
    esac
    _ld_id=${_ld_n%.meta}
    fs_is_id "$_ld_id" || continue
    fs_item_ok "$_ld_d" "$_ld_r" "$_ld_p" "$_ld_id" || continue
    if [ "$M_KIND" = file ]; then
      printf 'item %s %s %s %s %s %s\n' "$_ld_id" "$M_KIND" "$M_FROM" "$M_SIZE" "$M_SHA" "$M_NAME"
    else
      printf 'item %s %s %s %s %s\n' "$_ld_id" "$M_KIND" "$M_FROM" "$M_SIZE" "$M_SHA"
    fi
    LIST_N=$((LIST_N + 1))
  done <<EOF
$FS_LS
EOF
  return 0
}

# ── packets ────────────────────────────────────────────────────────────

# fs_check_packet FILE enroll|join: a carrier filter, not a trust decision.
# The lobby still parses and verifies every packet itself.
fs_check_packet() {
  case $2 in
    enroll) _cp_fmt=$ENROLL_FORMAT; _cp_keys=$ENROLL_KEYS ;;
    join) _cp_fmt=$JOIN_FORMAT; _cp_keys=$JOIN_KEYS ;;
    *) return 1 ;;
  esac
  fs_stat "$1" || return 1
  [ "$ST_TYPE" = "Regular File" ] && [ "$ST_SIZE" -ge 2 ] && [ "$ST_SIZE" -le "$LOBBY_MAX" ] || return 1
  "$ICONV" -f UTF-8 -t UTF-8 < "$1" > /dev/null 2>&1 || return 1
  _cp_n=$(tr -d '\n\040-\176\200-\377' < "$1" | wc -c) || return 1
  _cp_n=${_cp_n##* }
  [ "$_cp_n" = 0 ] || return 1
  _cp_1=
  _cp_2=
  { IFS= read -r _cp_1 && IFS= read -r _cp_2; } < "$1" || return 1
  [ "$_cp_1" = "{" ] || return 1
  [ "$_cp_2" = "  \"format\": \"$_cp_fmt\"," ] || return 1
  _cp_last=$(tail -n 1 < "$1") || return 1
  [ "$_cp_last" = "}" ] || return 1
  "$JQ" -e --arg f "$_cp_fmt" --argjson k "$_cp_keys" "$SHAPE_FILTER" < "$1" > /dev/null 2>&1 || return 1
  return 0
}

# fs_packet_display FILE: PK_KIND, PK_UNTIL, PK_HHMM, PK_LEFT (whole minutes
# left) and PK_EXPIRED (1 once valid_until has passed). Reads only kind and
# valid_until, after fs_check_packet.
fs_packet_display() {
  _pd_o=$("$JQ" -r "$DISPLAY_FILTER" < "$1" 2>/dev/null) || return 1
  _pd_tab=$(printf '\t')
  case $_pd_o in
    *"$_pd_tab"*) ;;
    *) return 1 ;;
  esac
  PK_KIND=${_pd_o%%"$_pd_tab"*}
  PK_UNTIL=${_pd_o#*"$_pd_tab"}
  case $PK_KIND in
    enroll | renew) ;;
    *) return 1 ;;
  esac
  case $PK_UNTIL in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z) ;;
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z) ;;
    *) return 1 ;;
  esac
  _pd_d=$(printf '%s' "$PK_UNTIL" | cut -c1-4,6-7,9-10,12-13,15-16,18-19)
  _pd_e=$(date -j -u -f %Y%m%d%H%M%S "$_pd_d" +%s 2>/dev/null) || return 1
  fs_is_num "$_pd_e" || return 1
  PK_HHMM=$(printf '%s' "$PK_UNTIL" | cut -c12-16)
  _pd_now=$(date +%s)
  PK_LEFT=$(( (_pd_e - _pd_now) / 60 ))
  PK_EXPIRED=0
  if [ "$_pd_e" -le "$_pd_now" ]; then
    PK_LEFT=0
    PK_EXPIRED=1
  fi
  return 0
}

fs_quarantine() {
  "$XATTR" -w com.apple.quarantine "0081;$(printf %08x "$(date +%s)");ferry;" "$1" 2>/dev/null \
    || fs_die 6 unsafe "could not set the quarantine flag"
  return 0
}

# ── pruning ────────────────────────────────────────────────────────────

fs__prune_entry() {
  # $1 a name in the entered directory: remove a stale stray or orphan,
  # count a stray directory.
  fs_stat "./$1" || return 0
  if [ "$ST_TYPE" = Directory ]; then
    _pr_dirs=$((_pr_dirs + 1))
    return 0
  fi
  if [ "$ST_MTIME" -lt "$_pr_stale" ]; then
    rm -f -- "./$1" 2>/dev/null || :
    _pr_removed=$((_pr_removed + 1))
  fi
  return 0
}

fs__prune_items() {
  # $1 a peer directory (absolute).
  fs_enter "$1" || return 0
  fs_ls .
  while IFS= read -r _pi_n; do
    [ -n "$_pi_n" ] || continue
    case $_pi_n in
      *.meta) _pi_id=${_pi_n%.meta}; _pi_other=$_pi_id.body ;;
      *.body) _pi_id=${_pi_n%.body}; _pi_other=$_pi_id.meta ;;
      *) _pi_id= ;;
    esac
    if [ -z "$_pi_id" ] || ! fs_is_id "$_pi_id"; then
      fs__prune_entry "$_pi_n"
      continue
    fi
    _pi_ts=${_pi_id%%Z-*}
    _pi_ts=${_pi_ts%%T*}${_pi_ts#*T}
    if [ "$_pi_ts" -lt "$_pr_cut" ]; then
      rm -f -- "./$_pi_n" 2>/dev/null || :
      _pr_removed=$((_pr_removed + 1))
      continue
    fi
    if [ ! -e "./$_pi_other" ] && [ ! -L "./$_pi_other" ]; then
      fs__prune_entry "$_pi_n"
    fi
  done <<EOF
$FS_LS
EOF
  fs_leave
  return 0
}

fs__prune_level() {
  # $1 a spool directory (absolute), $2 top|lobby|area. Strays at this level
  # are pruned; for an area, its peer directories are pruned after.
  fs_enter "$1" || return 0
  fs_ls .
  _pl_names=$FS_LS
  _pl_peers=
  while IFS= read -r _pl_n; do
    [ -n "$_pl_n" ] || continue
    case $2:$_pl_n in
      top:lobby | top:files | top:.lock | lobby:in | lobby:out) continue ;;
    esac
    if [ "$2" = area ] && fs_is_peer "$_pl_n" && fs_dir_ok "./$_pl_n"; then
      _pl_peers="$_pl_peers $_pl_n"
      continue
    fi
    fs__prune_entry "$_pl_n"
  done <<EOF
$_pl_names
EOF
  fs_leave
  for _pl_p in $_pl_peers; do
    fs__prune_items "$1/$_pl_p"
  done
  return 0
}

# fs_prune: at most every 10 minutes per identity. Unacked items go after
# retain_days (by id time); strays, orphans and stage leftovers after
# STALE_MIN (by mtime). Stray directories are never removed, only counted.
fs_prune() {
  _pr_stamp=$STAGE/.pruned
  _pr_now=$(date +%s)
  if fs_stat "$_pr_stamp" && [ "$ST_TYPE" = "Regular File" ] && [ $((_pr_now - ST_MTIME)) -lt 600 ]; then
    return 0
  fi
  : > "$_pr_stamp" 2>/dev/null || fs_die 6 unsafe "could not write the prune stamp"
  _pr_cut=$(date -u -v-"$SITE_RETAIN_DAYS"d +%Y%m%d%H%M%S) || fs_die 6 unsafe "could not read the clock"
  _pr_stale=$((_pr_now - STALE_MIN * 60))
  _pr_removed=0
  _pr_dirs=0
  fs_lock
  fs__prune_level "$SPOOL" top
  fs__prune_level "$SPOOL/lobby" lobby
  fs__prune_level "$SPOOL/lobby/in" area
  fs__prune_level "$SPOOL/lobby/out" area
  fs__prune_level "$SPOOL/files" area
  fs_unlock
  fs_ls "$STAGE"
  _pr_top=$FS_LS
  while IFS= read -r _pr_n; do
    case $_pr_n in
      '' | .pruned) continue ;;
    esac
    if fs_stat "$STAGE/$_pr_n" && [ "$ST_MTIME" -lt "$_pr_stale" ]; then
      rm -rf -- "${STAGE:?}/$_pr_n" 2>/dev/null || :
      _pr_removed=$((_pr_removed + 1))
    fi
  done <<EOF
$_pr_top
EOF
  if [ "$_pr_removed" -gt 0 ]; then
    fs__log prune 0 - - - "$_pr_removed"
  fi
  if [ "$_pr_dirs" -gt 0 ]; then
    fs__log prune 6 - - - "$_pr_dirs"
  fi
  return 0
}

# ── output helpers shared by the hub ───────────────────────────────────

fs_age() {
  _ag_ts=${1%%-*}
  _ag_e=$(date -j -u -f %Y%m%dT%H%M%SZ "$_ag_ts" +%s 2>/dev/null) || _ag_e=$(date +%s)
  _ag_s=$(($(date +%s) - _ag_e))
  if [ "$_ag_s" -lt 60 ]; then
    AGE="just now"
  elif [ "$_ag_s" -lt 3600 ]; then
    AGE="$((_ag_s / 60)) min ago"
  elif [ "$_ag_s" -lt 172800 ]; then
    AGE="$((_ag_s / 3600)) h ago"
  else
    AGE="$((_ag_s / 86400)) d ago"
  fi
  return 0
}

# fs_safe_name BASENAME: map to the file-name grammar, or return 1.
fs_safe_name() {
  _sn=$(printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_')
  while :; do
    case $_sn in
      .* | -*) _sn=${_sn#?} ;;
      *) break ;;
    esac
  done
  _sn=$(printf '%s' "$_sn" | cut -c1-100)
  fs_is_name "$_sn" || return 1
  SAFE_NAME=$_sn
  return 0
}
