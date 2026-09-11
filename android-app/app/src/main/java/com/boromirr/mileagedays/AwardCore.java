package com.boromirr.mileagedays;

import org.json.*;
import java.time.*;
import java.time.format.*;
import java.util.*;

/** No Android dependencies: the public indicators never represent seat counts. */
public final class AwardCore {
    public static final String ENDPOINT = "https://www.koreanair.com/api/hmp/bonusSeatView/bonusSeatView";
    public static final String PUBLIC_PAGE = "https://www.koreanair.com/booking/book-and-manage/award-seat-availability";
    public static final String[] CLASS_CODES = {"X", "N", "O", "A", "P", "Z"};
    public static final String[] CLASS_NAMES = {"일반석 보너스", "프리미엄석 보너스", "프레스티지석 보너스", "일등석 보너스·승급", "프리미엄석 승급", "프레스티지석 승급"};
    public static final ZoneId KOREA = ZoneId.of("Asia/Seoul");
    public static LocalDate today() { return LocalDate.now(KOREA); }
    public static boolean inRange(LocalDate date, LocalDate today) { return !date.isBefore(today) && !date.isAfter(today.plusDays(359)); }

    public static final class Failure extends Exception {
        public final String code;
        public final int httpStatus;
        public Failure(String code, String message) { this(code, message, 0); }
        public Failure(String code, String message, int httpStatus) { super(message); this.code = code; this.httpStatus = httpStatus; }
    }
    public static final class Query {
        public final String origin, destination;
        public final YearMonth month;
        public Query(String origin, String destination, YearMonth month, LocalDate today) throws Failure {
            if (origin == null || destination == null || !origin.matches("[A-Z]{3}") || !destination.matches("[A-Z]{3}") || origin.equals(destination))
                throw new Failure("INVALID_ROUTE", "서로 다른 출발·도착 공항을 선택해 주세요.");
            if (month == null || month.isBefore(YearMonth.from(today)) || month.isAfter(YearMonth.from(today.plusDays(359))))
                throw new Failure("INVALID_MONTH", "오늘부터 360일 이내의 월을 선택해 주세요.");
            this.origin = origin; this.destination = destination; this.month = month;
        }
        public String body() throws JSONException {
            return new JSONObject().put("departureAirport", origin).put("arrivalAirport", destination)
                .put("departureDate", month.atDay(1).format(DateTimeFormatter.BASIC_ISO_DATE)).toString();
        }
    }
    public static final class Flight {
        public final String number, time;
        public final Map<String, Boolean> status = new LinkedHashMap<>();
        Flight(String number, String time) { this.number = number; this.time = time; }
    }
    public static final class Day {
        public final LocalDate date;
        public final List<Flight> flights;
        public final boolean verified;
        Day(LocalDate date, List<Flight> flights) {
            this.date = date; this.verified = flights != null;
            this.flights = flights == null ? Collections.emptyList() : flights;
        }
        // 1 = an affirmative indicator; 0 = explicit negatives/no listed flights; -1 = no matching public data.
        public int indicator(String cabin) {
            if (!verified) return -1;
            if (flights.isEmpty()) return 0;
            String[] codes = cabin.equals("all") ? new String[]{"X", "N", "O", "A"} : new String[]{cabin};
            boolean missing = false;
            for (Flight flight : flights) {
                boolean hasRelevant = false;
                for (String code : codes) {
                    Boolean value = flight.status.get(code);
                    if (Boolean.TRUE.equals(value)) return 1;
                    if (value != null) hasRelevant = true;
                }
                if (!hasRelevant) missing = true;
            }
            return missing ? -1 : 0;
        }
    }
    public static final class CalendarResult {
        public final Query query;
        public final List<Day> days;
        public final Instant fetchedAt;
        CalendarResult(Query query, List<Day> days, Instant fetchedAt) { this.query = query; this.days = days; this.fetchedAt = fetchedAt; }
    }
    private static Failure invalid() { return new Failure("INVALID_RESPONSE", "대한항공 응답 형식이 예상과 달라 좌석 현황을 읽지 못했습니다."); }
    private static String string(JSONObject obj, String key) throws JSONException, Failure {
        Object value = obj.get(key); if (!(value instanceof String)) throw invalid(); return (String) value;
    }
    public static CalendarResult parse(String raw, Query query, Instant received) throws Failure {
        if (raw == null || raw.length() > 1000000) throw invalid();
        try {
            JSONObject root = new JSONObject(raw);
            if (!query.origin.equals(string(root,"departureAirport")) || !query.destination.equals(string(root,"arrivalAirport"))) throw invalid();
            JSONArray dates = root.getJSONArray("flightList");
            if (dates.length() == 0) throw new Failure("NO_PUBLIC_DATA", "이 노선과 월에 제공되는 공개 좌석 현황이 없습니다.");
            Map<LocalDate,List<Flight>> byDate = new HashMap<>();
            for (int i = 0; i < dates.length(); i++) {
                JSONObject date = dates.getJSONObject(i);
                String compact = string(date,"departureDate");
                if (!compact.matches("[0-9]{8}")) throw invalid();
                LocalDate day = LocalDate.parse(compact, DateTimeFormatter.BASIC_ISO_DATE);
                if (!YearMonth.from(day).equals(query.month) || byDate.containsKey(day)) throw invalid();
                JSONArray records = date.getJSONArray("flightDetailList");
                Map<String,Flight> flights = new TreeMap<>();
                for (int j = 0; j < records.length(); j++) {
                    JSONObject record = records.getJSONObject(j);
                    String number = string(record,"flightNumber"), time = string(record,"departureTime"), code = string(record,"bookingClass");
                    Object available = record.get("availableSeat");
                    if (!number.matches("KE[0-9]{1,4}") || !time.matches("([01][0-9]|2[0-3]):[0-5][0-9]") || !(available instanceof Boolean) || !Arrays.asList(CLASS_CODES).contains(code)) throw invalid();
                    String key = time + "|" + number;
                    Flight flight = flights.get(key);
                    if (flight == null) { flight = new Flight(number, time); flights.put(key, flight); }
                    if (flight.status.containsKey(code)) throw invalid();
                    flight.status.put(code,(Boolean)available);
                }
                byDate.put(day,new ArrayList<>(flights.values()));
            }
            List<Day> days = new ArrayList<>();
            for (int i = 1; i <= query.month.lengthOfMonth(); i++) {
                LocalDate date = query.month.atDay(i); days.add(new Day(date,byDate.get(date)));
            }
            return new CalendarResult(query,days,received);
        } catch (JSONException | DateTimeException e) { throw invalid(); }
    }
    public static String bookingUrl(Query query, LocalDate date, String cabin, LocalDate today) throws Failure {
        if (date == null || !YearMonth.from(date).equals(query.month) || !inRange(date,today)) throw new Failure("INVALID_DATE", "예약할 날짜를 다시 선택해 주세요.");
        String klass;
        switch (cabin) { case "X": klass="Y"; break; case "N": klass="V"; break; case "O": klass="C"; break; case "A": klass="F"; break; default: throw new Failure("INVALID_CABIN", "예약할 좌석 등급을 선택해 주세요."); }
        return "https://www.koreanair.com/booking/search?bookingType=A&tripType=OW&departure=" + query.origin + "&arrival=" + query.destination + "&departureDate=" + date + "&cabinClass=" + klass;
    }
    public static Failure httpFailure(int status) {
        String explanation = status == 403 ? "대한항공이 이 직접 조회 요청을 거절했습니다." : status == 401 ? "대한항공이 인증이 필요한 응답을 보냈습니다." : status == 429 ? "대한항공이 요청 횟수를 제한했습니다. 자동으로 재시도하지 않습니다." : status >= 300 && status < 400 ? "대한항공이 다른 페이지로 이동을 요구했습니다. 자동으로 따라가지 않습니다." : "대한항공에서 정상적인 조회 응답을 받지 못했습니다.";
        return new Failure("HTTP_" + status, explanation + " (HTTP " + status + ")", status);
    }
    private AwardCore() {}
}
