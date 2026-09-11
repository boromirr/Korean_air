package com.boromirr.mileagedays;

import javax.net.ssl.HttpsURLConnection;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Locale;

/** One user-initiated native HTTPS POST; no credentials, WebView, proxy, retries or redirects. */
public final class AwardClient {
    interface ConnectionFactory { HttpsURLConnection open() throws IOException; }
    private final ConnectionFactory factory;
    private volatile HttpsURLConnection active;
    private volatile boolean cancelled;
    private volatile boolean timedOut;
    public AwardClient() { this(() -> (HttpsURLConnection)new URL(AwardCore.ENDPOINT).openConnection()); }
    AwardClient(ConnectionFactory factory) { this.factory = factory; }
    public void cancel() { cancelled = true; HttpsURLConnection connection = active; if (connection != null) connection.disconnect(); }
    public void timeout() { timedOut = true; cancel(); }
    public AwardCore.CalendarResult fetch(AwardCore.Query query) throws AwardCore.Failure {
        HttpsURLConnection connection = null;
        try {
            if (cancelled) throw new IOException("cancelled");
            connection = factory.open(); active = connection;
            if (cancelled) throw new IOException("cancelled");
            connection.setConnectTimeout(15000); connection.setReadTimeout(25000);
            connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
            connection.setRequestMethod("POST"); connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "KoreanAirPersonal/0.1 (Android)");
            byte[] payload = query.body().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(payload.length);
            try (OutputStream out = connection.getOutputStream()) { out.write(payload); }
            int status = connection.getResponseCode();
            if (status != 200) throw AwardCore.httpFailure(status);
            String type = connection.getContentType();
            if (type == null || !type.toLowerCase(Locale.ROOT).split(";",2)[0].trim().equals("application/json"))
                throw new AwardCore.Failure("NON_JSON", "HTTP 200 응답을 받았지만 좌석 JSON 데이터가 아닙니다.", status);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream in = connection.getInputStream()) {
                byte[] buffer = new byte[8192]; int n;
                while ((n = in.read(buffer)) != -1) {
                    if (cancelled) throw new IOException("cancelled");
                    if (bytes.size() + n > 1000000) throw new AwardCore.Failure("TOO_LARGE", "응답 크기가 예상 범위를 벗어났습니다.");
                    bytes.write(buffer,0,n);
                }
            }
            return AwardCore.parse(new String(bytes.toByteArray(),StandardCharsets.UTF_8),query,Instant.now());
        } catch (SocketTimeoutException e) { throw new AwardCore.Failure("TIMEOUT", "대한항공 응답 대기 시간이 초과되었습니다."); }
        catch (IOException e) { if(timedOut) throw new AwardCore.Failure("TIMEOUT", "대한항공 응답 대기 시간이 초과되었습니다."); throw new AwardCore.Failure("NETWORK_ERROR", "대한항공에 연결하지 못했습니다. 휴대폰의 인터넷 연결을 확인해 주세요."); }
        catch (org.json.JSONException e) { throw new AwardCore.Failure("INVALID_QUERY", "조회 조건을 만들지 못했습니다."); }
        finally { active = null; if (connection != null) connection.disconnect(); }
    }
}
