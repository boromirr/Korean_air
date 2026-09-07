# Public calendar fixture

`public-calendar-icn-jfk-2027-04.html` is a reduced copy of the actual anonymous ICN → JFK, one-way, April 2027 calendar captured on 2026-09-07. It retains the result heading, selected month, complete 30-day table, and public legend. Angular attributes, comments, styling, month navigation, and unrelated UI were removed. Day IDs, day numbers, and availability marker texts were preserved.

Observed: economy award on all 30 dates; prestige upgrade on April 4, 9, 15, 17, and 18 only. No actual unavailable-day or first-class day cells occurred in this sample.

`public-calendar-icn-sin-2026-11.html` and `public-calendar-icn-cdg-2026-11.html` are reduced copies of the real anonymous calendars captured later on 2026-09-07. They retain the complete month tables, headings, and month selectors. Singapore has prestige award markers on November 4, 5, 7, 9, 15, 16, 18, 20, 21, 24, 25, 27, 28, and 29. Paris contains four actual no-seat day cells: a direct child `span.ux-class-icon.-no-seat.-gray` inside `.bonus-calendar__day` with text `좌석 없음`. Only this observed unavailable state is accepted. Empty or no-flight day structures still fail closed.

Synthetic first-class markers use the observed combined legend label; they preserve both separate values as `null` and `firstAwardOrUpgrade: true`, never infer which product exists. Other test mutations remain synthetic defensive cases.

The fixture contains no account information, cookie values, request bodies, or credentials. Parser tests are local and never contact the airline.
