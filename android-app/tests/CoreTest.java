package com.boromirr.mileagedays;

import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.cert.Certificate;
import javax.net.ssl.HttpsURLConnection;
import java.time.*;
import org.json.*;

public class CoreTest {
    static int checks;
    static void check(boolean value,String message) { checks++; if(!value)throw new AssertionError(message); }
    interface Operation { void run() throws Exception; }
    static void fails(String code,Operation action) throws Exception {
        try { action.run(); throw new AssertionError("Expected "+code); }
        catch(AwardCore.Failure e) { check(code.equals(e.code),"Unexpected error "+e.code); }
    }
    static final LocalDate TODAY=LocalDate.of(2026,9,11);
    static AwardCore.Query q() throws Exception { return new AwardCore.Query("ICN","JFK",YearMonth.of(2026,11),TODAY); }
    static final Instant RECEIVED=Instant.parse("2026-09-11T00:44:18Z");
    public static void main(String[] args) throws Exception {
        String raw=new String(Files.readAllBytes(Paths.get(args[0])),StandardCharsets.UTF_8);
        AwardCore.CalendarResult result=AwardCore.parse(raw,q(),RECEIVED);
        check(result.days.size()==30,"30 dates from real fixture");
        int x=0,o=0,z=0,a=0,flights=0;
        for(AwardCore.Day day:result.days) for(AwardCore.Flight f:day.flights) { flights++;if(Boolean.TRUE.equals(f.status.get("X")))x++;if(Boolean.TRUE.equals(f.status.get("O")))o++;if(Boolean.TRUE.equals(f.status.get("Z")))z++;if(Boolean.TRUE.equals(f.status.get("A")))a++; }
        check(flights==60&&x==58&&o==0&&z==8&&a==0,"fixture indicators are not seat counts");
        check(result.fetchedAt.equals(RECEIVED),"receipt timestamp preserved");
        check(result.days.get(2).indicator("O")==0,"upgrade does not imply prestige award");
        check(result.days.get(0).indicator("N")==-1,"unreported premium is unknown");
        JSONObject partial=new JSONObject(raw);partial.getJSONArray("flightList").remove(1);
        check(!AwardCore.parse(partial.toString(),q(),RECEIVED).days.get(1).verified,"omitted day unknown");
        check(AwardCore.parse(partial.toString(),q(),RECEIVED).days.get(1).indicator("X")==-1,"omitted day not unavailable");
        JSONObject wrong=new JSONObject(raw).put("arrivalAirport","LAX");fails("INVALID_RESPONSE",()->AwardCore.parse(wrong.toString(),q(),RECEIVED));
        JSONObject duplicate=new JSONObject(raw);duplicate.getJSONArray("flightList").put(duplicate.getJSONArray("flightList").get(0));fails("INVALID_RESPONSE",()->AwardCore.parse(duplicate.toString(),q(),RECEIVED));
        JSONObject stringBool=new JSONObject(raw);stringBool.getJSONArray("flightList").getJSONObject(0).getJSONArray("flightDetailList").getJSONObject(0).put("availableSeat","true");fails("INVALID_RESPONSE",()->AwardCore.parse(stringBool.toString(),q(),RECEIVED));
        JSONObject malformed=new JSONObject(raw);malformed.getJSONArray("flightList").getJSONObject(0).put("departureDate","20261131");fails("INVALID_RESPONSE",()->AwardCore.parse(malformed.toString(),q(),RECEIVED));
        JSONObject unknown=new JSONObject(raw);unknown.getJSONArray("flightList").getJSONObject(0).getJSONArray("flightDetailList").getJSONObject(0).put("bookingClass","NEW");fails("INVALID_RESPONSE",()->AwardCore.parse(unknown.toString(),q(),RECEIVED));
        JSONObject empty=new JSONObject(raw).put("flightList",new JSONArray());fails("NO_PUBLIC_DATA",()->AwardCore.parse(empty.toString(),q(),RECEIVED));
        fails("INVALID_RESPONSE",()->AwardCore.parse("<html>Access denied</html>",q(),RECEIVED));
        fails("INVALID_ROUTE",()->new AwardCore.Query("ICN","ICN",YearMonth.of(2026,11),TODAY));
        fails("INVALID_MONTH",()->new AwardCore.Query("ICN","JFK",YearMonth.of(2028,11),TODAY));
        check(AwardCore.inRange(TODAY.plusDays(359),TODAY)&&!AwardCore.inRange(TODAY.plusDays(360),TODAY),"360-day boundary");
        String url=AwardCore.bookingUrl(q(),LocalDate.of(2026,11,4),"O",TODAY);
        check(url.equals("https://www.koreanair.com/booking/search?bookingType=A&tripType=OW&departure=ICN&arrival=JFK&departureDate=2026-11-04&cabinClass=C"),"official date/route/cabin query");
        fails("INVALID_CABIN",()->AwardCore.bookingUrl(q(),LocalDate.of(2026,11,4),"all",TODAY));
        fails("INVALID_DATE",()->AwardCore.bookingUrl(q(),LocalDate.of(2026,12,4),"X",TODAY));
        for(int status:new int[]{401,403,429,302,500}) {
            FakeConnection fake=new FakeConnection(status,"text/html","Access Denied");int[] opened={0};
            AwardClient client=new AwardClient(()->{opened[0]++;return fake;});fails("HTTP_"+status,()->client.fetch(q()));
            check(opened[0]==1&&!fake.getInstanceFollowRedirects(),"single call, no retry/redirect");check(fake.disconnected,"connection closed on HTTP error");
        }
        FakeConnection html=new FakeConnection(200,"text/html","<html>Challenge</html>");fails("NON_JSON",()->new AwardClient(()->html).fetch(q()));
        FakeConnection success=new FakeConnection(200,"application/json; charset=utf-8",raw);
        check(new AwardClient(()->success).fetch(q()).days.size()==30,"native client receives parsed result");
        JSONObject body=new JSONObject(success.sent.toString("UTF-8"));
        check(body.length()==3&&body.getString("departureDate").equals("20261101")&&body.getString("arrivalAirport").equals("JFK"),"flat request schema");
        check(success.getRequestMethod().equals("POST")&&success.getConnectTimeout()==15000&&success.getReadTimeout()==25000,"method and timeouts");
        check(success.getRequestProperty("Cookie")==null&&success.getRequestProperty("Authorization")==null&&success.getRequestProperty("Origin")==null,"no session or browser headers");
        AwardClient timeout=new AwardClient(()->{throw new AssertionError("timeout must prevent network");});timeout.timeout();fails("TIMEOUT",()->timeout.fetch(q()));
        System.out.println("PASS: "+checks+" checks; no live airline requests.");
    }
    static final class FakeConnection extends HttpsURLConnection {
        final int status;final String type,body;boolean disconnected;final ByteArrayOutputStream sent=new ByteArrayOutputStream();
        FakeConnection(int status,String type,String body)throws Exception{super(new URL(AwardCore.ENDPOINT));this.status=status;this.type=type;this.body=body;}
        public void connect(){} public void disconnect(){disconnected=true;} public boolean usingProxy(){return false;}
        public String getCipherSuite(){return "test";}public Certificate[]getLocalCertificates(){return null;}public Certificate[]getServerCertificates(){return null;}
        public OutputStream getOutputStream(){return sent;}public int getResponseCode(){return status;}public String getContentType(){return type;}
        public InputStream getInputStream(){return new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));}
    }
}
