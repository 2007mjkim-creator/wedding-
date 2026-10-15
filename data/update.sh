#!/usr/bin/env bash
# ====================================================
# 전국 웨딩 업체 데이터 갱신 스크립트
#
# 사용법 (Git Bash):
#   bash data/update.sh "소상공인시장진흥공단_상가(상권)정보_YYYYMMDD.zip" "YYYY.MM"
#
# 1) 공공데이터포털에서 '소상공인시장진흥공단_상가(상권)정보' zip을 받아 이 저장소 폴더에 둡니다.
#    (zip/csv는 .gitignore 로 GitHub에 올라가지 않습니다)
# 2) 위 명령을 실행하면 data/wedding-directory.json 이 새로 만들어집니다.
# 3) index.html 홈 화면 카드의 업체 수(전국 웨딩 업체 찾기 N곳)를 출력된 숫자로 바꿔 줍니다.
# ====================================================
set -euo pipefail

ZIP="${1:?zip 파일 경로를 입력하세요}"
VERSION="${2:?기준 연월을 입력하세요 (예: 2026.09)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "1/3 관련 업종 추출 중… (1~2분)"
unzip -p "$ZIP" '*.csv' | awk -v FPAT='([^,]*)|("[^"]*")' -v OFS='\t' '
function u(s){ gsub(/^"|"$/, "", s); gsub(/\t/, " ", s); return s }
$1 == "\"상가업소번호\"" { next }
{
  sub_ = u($9); std = u($11)
  keep = (sub_ == "예식장업" || sub_ == "결혼 상담 서비스업" || sub_ == "의류 대여업" || sub_ == "한복 소매업" || sub_ == "시계/귀금속 소매업" || (sub_ == "사진촬영업" && std ~ /인물 사진/) || (sub_ == "미용실" && std == "두발 미용업"))
  if (keep) print u($1), u($2), u($3), sub_, u($13), u($15), u($17), u($32), u($25), u($31), u($36), u($38), u($39)
}' > "$TMP/candidates.tsv"

echo "2/3 웨딩 업체 분류 중…"
awk -f "$HERE/classify.awk" -f "$HERE/build_items.awk" "$TMP/candidates.tsv" \
  | LC_ALL=C sort -t$'\t' -k1,1 -k2,2 -k3,3 -k4,4 | cut -f5 > "$TMP/items.jsonl"

echo "3/3 JSON 생성 중…"
{
  printf '{"version":"%s","source":"소상공인시장진흥공단 상가(상권)정보 (%s 기준)","fields":["category","name","branch","sido","sigungu","dong","address","building","floor","lng","lat"],"items":[\n' "$VERSION" "$VERSION"
  sed '$!s/$/,/' "$TMP/items.jsonl"
  printf ']}\n'
} > "$HERE/wedding-directory.json"

echo "완료: 총 $(wc -l < "$TMP/items.jsonl")곳"
cut -d, -f1 "$TMP/items.jsonl" | sort | uniq -c | sort -rn
