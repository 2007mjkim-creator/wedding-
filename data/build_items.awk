# classify.awk 와 함께 실행: 분류된 업체를 JSON 배열 한 줄씩 출력 (앞에 정렬 키)
# 배열: [카테고리, 상호, 지점, 시도, 시군구, 행정동, 주소, 건물명, 층, 경도, 위도]
function j(s) {
  gsub(/\\/, "\\\\", s)
  gsub(/"/, "\\\"", s)
  gsub(/[[:cntrl:]]/, " ", s)
  return "\"" s "\""
}
function short(s) {
  if (s ~ /^서울/) return "서울"
  if (s ~ /^부산/) return "부산"
  if (s ~ /^대구/) return "대구"
  if (s ~ /^인천/) return "인천"
  if (s ~ /^광주/) return "광주"
  if (s ~ /^대전/) return "대전"
  if (s ~ /^울산/) return "울산"
  if (s ~ /^세종/) return "세종"
  if (s ~ /^경기/) return "경기"
  if (s ~ /^강원/) return "강원"
  if (s ~ /^충청북|^충북/) return "충북"
  if (s ~ /^충청남|^충남/) return "충남"
  if (s ~ /^전라북|^전북/) return "전북"
  if (s ~ /^전라남|^전남/) return "전남"
  if (s ~ /^경상북|^경북/) return "경북"
  if (s ~ /^경상남|^경남/) return "경남"
  if (s ~ /^제주/) return "제주"
  return s
}
{
  c = classify($4, $2)
  if (c == "") next
  key = c SUBSEP $2 SUBSEP $3 SUBSEP $8
  if (key in seen) next
  seen[key] = 1
  addr = ($8 != "" ? $8 : $9)
  lng = ($12 != "" ? sprintf("%.5f", $12) : "null")
  lat = ($13 != "" ? sprintf("%.5f", $13) : "null")
  printf "%s\t%s\t%s\t%s\t[%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s]\n", short($5), $6, c, $2, j(c), j($2), j($3), j(short($5)), j($6), j($7), j(addr), j($10), j($11), lng, lat
}
