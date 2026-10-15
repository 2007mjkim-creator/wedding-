# 입력: candidates.tsv (id, 상호, 지점, 소분류, 시도, 시군구, 행정동, 도로명주소, 지번주소, 건물명, 층, 경도, 위도)
# 출력 카테고리: hall studio dress makeup jewelry hanbok planner (해당 없으면 빈 문자열)
BEGIN { FS = "\t"; IGNORECASE = 1 }
function classify(sub_, name) {
  if (sub_ == "예식장업") {
    # 원본에 예식장업으로 잘못 등록된 비관련 업체 제외, 스튜디오·드레스는 재분류
    if (name ~ /국제결혼|결혼정보|중매|장묘|장의|장례|상조|부동산|인베스트|투자|산업|캠프|플레이랜드|아이앤디|화인에스디/ && name !~ /컨벤션|웨딩|홀/) return ""
    if (name ~ /스튜디오|studio/) return "studio"
    if (name ~ /드레스|dress/) return "dress"
    return "hall"
  }
  if (sub_ == "사진촬영업" && name ~ /웨딩|wedding|브라이덜|bridal|스냅|snap|본식|신부|드레스/) return "studio"
  if (sub_ == "의류 대여업" && name ~ /웨딩|wedding|드레스|dress|브라이덜|bridal|턱시도|예복/ && name !~ /장례|상복|수의|상조/) return "dress"
  if (sub_ == "미용실" && name ~ /웨딩|wedding|브라이덜|bridal|메이크업|makeup|make ?up/) return "makeup"
  if (sub_ == "시계/귀금속 소매업" && name ~ /웨딩|wedding|예물|웨딩밴드|브라이덜|bridal|커플링|다이아/) return "jewelry"
  if (sub_ == "한복 소매업" && name ~ /한복|주단|혼수|비단|돌실나이|규방|예단/) return "hanbok"
  if (sub_ == "결혼 상담 서비스업" && name ~ /웨딩|wedding|플래너|planner|브라이덜|bridal/ && name !~ /결혼정보|정보회사|중매|듀오|가연|매칭|국제|커플매니저|재혼|결혼상담소|결혼중개|스쿨|연합|협회|협동조합|고객센터/) return "planner"
  return ""
}
