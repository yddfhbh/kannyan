# V-ARCHIVE 카드 글꼴

`assets/fonts/NotoSansCJKkr-Bold-KR-Subset.otf`는 기존
`NotoSansCJKkr-Bold.otf`에서 `scripts/font-subset.py`로 생성한 정적 asset이다.
기본 라틴, 라틴-1, Hangul Jamo/Compatibility Jamo, Hangul syllable과 카드 fixture의
기호만 포함한다. 런타임에는 fontTools나 font cmap을 실행하지 않고
`src/varchive-font-selection.js`의 정적 coverage range로 실제 카드 text content를
검사한다. 범위를 벗어나는 문자가 하나라도 있으면 전체 원본 font를 사용한다.
