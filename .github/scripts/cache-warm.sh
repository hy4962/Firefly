#!/usr/bin/env bash
# Vercel 缓存预热脚本（适配 9ll.uk 博客）
#
# 流程：
#   1. 从 https://www.9ll.uk/sitemap-index.xml 读取分片清单，
#      逐个抓取 sitemap-N.xml 收集全站 URL
#   2. 多轮并发 curl 请求每个页面
#   3. 每轮统计 x-vercel-cache HIT 数 / 命中率，达到目标或轮数上限后结束
#
# 注意：
#   - 不要加 Cache-Control: no-cache 请求头，否则会强制 CDN 重新验证，全测成 MISS
#   - curl 本身没有客户端缓存，天然忽略浏览器缓存
#   - Vercel 边缘缓存按区域分片，GitHub Actions 的出口在美国，
#     预热的是美区边缘节点；国内访客命中与否取决于其就近节点的缓存状态，
#     所以 HIT 目标不设 100%

set -u -o pipefail

BASE_URL="${BASE_URL:-https://www.9ll.uk}"
PARALLEL="${PARALLEL:-4}"
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-30}"
HIT_TARGET="${HIT_TARGET:-80}"
MAX_CYCLES="${MAX_CYCLES:-4}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-20}"

for variable_name in PARALLEL REQUEST_TIMEOUT HIT_TARGET MAX_CYCLES INTERVAL_SECONDS; do
  if [[ ! "${!variable_name}" =~ ^[0-9]+$ ]]; then
    echo "::error::${variable_name} 必须是非负整数"
    exit 1
  fi
done

# 中转文件（脚本退出时统一清理）
STARTUP_LOG="$(mktemp)"
URLS_TMP="$(mktemp)"
cleanup() {
  rm -f "$STARTUP_LOG" "$URLS_TMP" urls.txt metrics_file 2>/dev/null || true
}
trap cleanup EXIT

# 1. 从 sitemap-index.xml 解析分片清单，再逐片收集 URL
if curl -fsS --retry 2 --retry-delay 2 -m 30 "${BASE_URL}/sitemap-index.xml" -o "$STARTUP_LOG"; then
  while IFS= read -r shard; do
    curl -fsS --retry 2 --retry-delay 2 -m 30 "$shard" \
      | grep -oP '(?<=<loc>)[^<]+' \
      | sed 's/\r$//' >> "$URLS_TMP" || true
  done < <(grep -oP '(?<=<loc>)[^<]+' "$STARTUP_LOG" | sed 's/\r$//')
fi
# 兜底：直接抓 sitemap-0.xml / sitemap.xml
if [ ! -s "$URLS_TMP" ]; then
  for shard in "${BASE_URL}/sitemap-0.xml" "${BASE_URL}/sitemap.xml"; do
    curl -fsS --retry 2 --retry-delay 2 -m 30 "$shard" \
      | grep -oP '(?<=<loc>)[^<]+' \
      | sed 's/\r$//' >> "$URLS_TMP" && break || true
  done
fi
if [ ! -s "$URLS_TMP" ]; then
  echo "::error::无法从 sitemap 获取任何 URL，预热中止"
  exit 1
fi

sort -u "$URLS_TMP" -o urls.txt
url_count=$(wc -l < urls.txt)
echo "🌐 从 sitemap 收集到 ${url_count} 个页面，目标 HIT 率 ${HIT_TARGET}%（最多 ${MAX_CYCLES} 轮）"

warm_url() {
  local url="$1"
  local header_file metric http_code response_time remote_ip cache_status age_seconds

  header_file="$(mktemp)"
  metric="$(curl -sS -o /dev/null -m "$REQUEST_TIMEOUT" -D "$header_file" \
    -w '%{http_code}\t%{time_total}\t%{remote_ip}' "$url" 2>/dev/null || true)"
  IFS=$'\t' read -r http_code response_time remote_ip <<< "$metric"
  cache_status="$(awk '
    tolower($0) ~ /^x-vercel-cache:/ {
      value = $0
      sub(/^[^:]*:[[:space:]]*/, "", value)
      sub(/\r$/, "", value)
      print value
    }
  ' "$header_file" | tail -n 1)"
  age_seconds="$(awk '
    tolower($0) ~ /^age:/ {
      value = $0
      sub(/^[^:]*:[[:space:]]*/, "", value)
      sub(/\r$/, "", value)
      if (value ~ /^[0-9]+$/) print value
    }
  ' "$header_file" | tail -n 1)"

  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$url" \
    "${http_code:-000}" \
    "${response_time:-0.000000}" \
    "${remote_ip:-unknown}" \
    "${cache_status:-NONE}" \
    "${age_seconds:-}"
  rm -f "$header_file"
}
export -f warm_url
export REQUEST_TIMEOUT

cycle=0
hits=0
hit_rate=0
while [ "$cycle" -lt "$MAX_CYCLES" ]; do
  cycle=$((cycle + 1))
  cycle_start="$(date +%s)"
  metrics_file="$(mktemp)"

  xargs -P "$PARALLEL" -I {} bash -c 'warm_url "$@"' _ {} \
    < urls.txt > "$metrics_file" || true

  summary="$(awk -F '\t' '
    {
      total++
      code=$2 + 0
      if (code >= 200 && code < 400) successful++
      response_sum += $3 + 0
      status=($5 == "" ? "NONE" : $5)
      if (status == "HIT") hits++
      if ($6 ~ /^[0-9]+$/) {
        age = $6 + 0
        age_total += age
        age_count++
        if (!age_seen || age < age_min) age_min = age
        if (!age_seen || age > age_max) age_max = age
        age_seen = 1
      }
    }
    END {
      average=total ? response_sum / total : 0
      hit_rate=total ? hits * 100 / total : 0
      age_average=age_count ? age_total / age_count : 0
      if (age_count)
        printf "%d\t%d\t%.3f\t%d\t%.1f\t%.0f\t%d\t%d", total, successful, average, hits, hit_rate, age_average, age_min, age_max
      else
        printf "%d\t%d\t%.3f\t%d\t%.1f\t-1\t-1\t-1", total, successful, average, hits, hit_rate
    }' "$metrics_file")"
  IFS=$'\t' read -r requested successful average_response hits hit_rate age_average age_min age_max <<< "$summary"

  ip_summary="$(awk -F '\t' '{print ($4 == "" ? "unknown" : $4)}' "$metrics_file" \
    | sort | uniq -c \
    | awk '{printf "%s%s(%s)", separator, $2, $1; separator=", "}')"
  status_summary="$(awk -F '\t' '{print ($5 == "" ? "NONE" : $5)}' "$metrics_file" \
    | sort | uniq -c \
    | awk '{printf "%s%s=%s", separator, $2, $1; separator=", "}')"

  elapsed=$(($(date +%s) - cycle_start))
  if [ "${age_average}" != "-1" ]; then
    age_summary="avg=${age_average%.*}s/min=${age_min}s/max=${age_max}s"
  else
    age_summary="N/A"
  fi

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 第 $cycle 轮：预热 $requested 个页面，用时 ${elapsed}s，成功 $successful/$requested，平均响应 ${average_response}s，IP ${ip_summary:-unknown}，状态 ${status_summary:-NONE}，命中 HIT ${hits}/${requested}(${hit_rate}%)，Age ${age_summary}"
  rm -f "$metrics_file"

  hit_pct="${hit_rate%.*}"
  if [ "$hit_pct" -ge "$HIT_TARGET" ]; then
    echo "✅ HIT 率 ${hit_rate}% ≥ 目标 ${HIT_TARGET}%，预热完成"
    break
  fi
  if [ "$cycle" -ge "$MAX_CYCLES" ]; then
    echo "⚠️ 已达最大轮数 ${MAX_CYCLES}，当前 HIT 率 ${hit_rate}%"
    break
  fi
  echo "⏳ HIT 率 ${hit_rate}% < 目标 ${HIT_TARGET}%，${INTERVAL_SECONDS} 秒后继续下一轮..."
  sleep "$INTERVAL_SECONDS"
done

echo "预热结束：共执行 $cycle 轮，最终 HIT 率 ${hit_rate}%"
