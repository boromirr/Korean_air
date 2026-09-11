package com.boromirr.mileagedays;

import android.app.*;
import android.os.*;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.view.*;
import android.view.inputmethod.InputMethodManager;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.*;

public final class MainActivity extends Activity {
    private static final int INK = Color.rgb(18,40,73), BLUE = Color.rgb(33,99,222), MUTED = Color.rgb(93,109,133), BG = Color.rgb(244,247,252), AMBER = Color.rgb(137,86,0);
    private static final String[] CABINS = {"전체 보너스", "일반석", "프리미엄석", "프레스티지석", "일등석 (보너스·승급)"};
    private static final String[] CODES = {"all", "X", "N", "O", "A"};
    private static final int PREMIUM = Color.rgb(11,128,97), PRESTIGE = Color.rgb(123,63,200), FIRST = Color.rgb(184,92,0);
    private final List<YearMonth> months = new ArrayList<>();
    private final LinkedHashMap<String,String> airports = new LinkedHashMap<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private AutoCompleteTextView origin, destination;
    private Spinner month, cabin;
    private Button search, swap;
    private TextView notice;
    private LinearLayout results, details;
    private SharedPreferences prefs;
    private volatile boolean dead;
    private boolean busy;
    private volatile AwardClient client;
    private AwardCore.CalendarResult current;
    private LocalDate selected;
    private String errorText;
    private LinearLayout root;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences("local-query", MODE_PRIVATE);
        loadAirports();
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(BG);
        root = column(); root.setPadding(dp(20),dp(22),dp(20),dp(28)); scroll.addView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            scroll.setOnApplyWindowInsetsListener((v,insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(bars.left,bars.top,bars.right,bars.bottom); return insets;
            });
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
        setContentView(scroll);
        TextView badge = text("PERSONAL · KOREAN AIR",11,BLUE,true); badge.setLetterSpacing(.12f); root.addView(badge);
        root.addView(text("마일리지 달력",30,INK,true),space(0,6));
        root.addView(text("한 달의 공개 좌석 현황을 한눈에",15,MUTED,false),space(0,6));
        LinearLayout form = card(); root.addView(form,space(0,24));
        form.addView(text("어디로 떠나시나요?",18,INK,true));
        form.addView(text("출발 공항",12,MUTED,true),space(0,18));
        origin = airportField(); form.addView(origin); origin.setText(prefs.getString("origin",airportLabel("ICN")),false);
        LinearLayout destHeader = row(); TextView destLabel = text("도착 공항",12,MUTED,true); destHeader.addView(destLabel,new LinearLayout.LayoutParams(0,dp(48),1)); destLabel.setGravity(Gravity.CENTER_VERTICAL);
        swap = button("출발 ↔ 도착",false); destHeader.addView(swap,new LinearLayout.LayoutParams(dp(130),dp(48))); form.addView(destHeader,space(0,6));
        destination = airportField(); form.addView(destination); destination.setText(prefs.getString("destination",airportLabel("JFK")),false);
        swap.setOnClickListener(v -> { String before = origin.getText().toString(); origin.setText(destination.getText(),false); destination.setText(before,false); });
        form.addView(text("출발 월",12,MUTED,true),space(0,18));
        LocalDate today = AwardCore.today(); YearMonth start = YearMonth.from(today), last = YearMonth.from(today.plusDays(359));
        List<String> monthLabels = new ArrayList<>();
        for (YearMonth m = start; !m.isAfter(last); m = m.plusMonths(1)) { months.add(m); monthLabels.add(m.getYear()+"년 "+m.getMonthValue()+"월"); }
        month = spinner(monthLabels.toArray(new String[0])); form.addView(month);
        String savedMonth = prefs.getString("month",start.plusMonths(1).toString());
        for (int i=0;i<months.size();i++) if (months.get(i).toString().equals(savedMonth)) month.setSelection(i);
        form.addView(text("좌석 등급",12,MUTED,true),space(0,18));
        cabin = cabinSpinner(); form.addView(cabin); cabin.setSelection(Math.max(0,Math.min(4,prefs.getInt("cabin",0))));
        cabin.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            public void onItemSelected(AdapterView<?> p,View v,int pos,long id) { if(current!=null) renderCalendar(); }
            public void onNothingSelected(AdapterView<?> p) {}
        });
        search = button("휴대폰에서 좌석 조회",true); form.addView(search,space(dp(56),22)); search.setOnClickListener(v -> search());
        notice = text("출발·도착 공항과 월을 선택하고 조회해 주세요.",14,MUTED,false); notice.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); root.addView(notice,space(0,18));
        results = column(); root.addView(results,space(0,16));
        Button official = button("대한항공 공개 좌석 현황 열기 ↗",false); root.addView(official,space(dp(52),18)); official.setOnClickListener(v -> open(AwardCore.PUBLIC_PAGE));
        root.addView(text("공개된 가능 여부이며 잔여 좌석 수가 아닙니다. 일등석은 보너스·승급이 합쳐진 표시입니다. 최종 예약 가능 여부는 대한항공에서 확인해 주세요.",12,MUTED,false),space(0,18));
        root.addView(text("개인용 비공식 앱 · 0.1.2\n조회 조건은 이 휴대폰에만 저장됩니다.",11,MUTED,false),space(0,12));
    }
    private void loadAirports() {
        try (InputStream in = getAssets().open("airports.json")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int n;
            while((n=in.read(buffer))!=-1) out.write(buffer,0,n);
            JSONArray list = new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8)).getJSONArray("airports");
            for(int i=0;i<list.length();i++) { JSONObject a=list.getJSONObject(i);airports.put(a.getString("code"),a.getString("name")); }
        } catch(Exception e) { airports.put("ICN","서울/인천"); airports.put("JFK","뉴욕/존 F. 케네디"); }
    }
    private String airportLabel(String code) { return airports.containsKey(code)?airports.get(code)+" ("+code+")":code; }
    private AutoCompleteTextView airportField() {
        AutoCompleteTextView field = new AutoCompleteTextView(this); field.setSingleLine(true); field.setTextSize(17); field.setTextColor(INK); field.setMinHeight(dp(52)); field.setPadding(dp(12),dp(6),dp(12),dp(6)); field.setBackground(shape(BG,dp(10),0)); field.setThreshold(1); field.setHint("공항 이름 또는 ICN 등 코드");
        field.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        List<String> labels = new ArrayList<>(); for(String code:airports.keySet()) labels.add(airportLabel(code));
        field.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_dropdown_item_1line,labels)); return field;
    }
    private String airportCode(AutoCompleteTextView input) throws AwardCore.Failure {
        String value = input.getText().toString().trim().toUpperCase(Locale.ROOT);
        for(String code:airports.keySet()) if(value.equals(code)||value.equals(airportLabel(code).toUpperCase(Locale.ROOT))||value.equals(airports.get(code).toUpperCase(Locale.ROOT))) return code;
        if(value.matches("[A-Z]{3}")) return value;
        throw new AwardCore.Failure("INVALID_AIRPORT","목록에서 공항을 고르거나 영문 공항 코드 3자를 입력해 주세요.");
    }
    private void search() {
        if(busy) return;
        final AwardCore.Query query;
        try { query = new AwardCore.Query(airportCode(origin),airportCode(destination),months.get(month.getSelectedItemPosition()),AwardCore.today()); }
        catch(AwardCore.Failure e) { notice.setText(e.getMessage()); notice.setTextColor(AMBER); return; }
        startSearch(query);
    }
    private void startSearch(AwardCore.Query query) {
        if(busy || dead) return;
        prefs.edit().putString("origin",origin.getText().toString()).putString("destination",destination.getText().toString()).putString("month",query.month.toString()).putInt("cabin",cabin.getSelectedItemPosition()).apply();
        ((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(origin.getWindowToken(),0);
        results.setMinimumHeight(results.getHeight());
        current = null; selected = null; errorText = null; results.removeAllViews(); setBusy(true);
        LinearLayout loading = card(); results.addView(loading); addMonthHeader(loading,query);
        loading.addView(text("이 달의 좌석 현황을 조회하고 있습니다…",14,MUTED,false),space(0,16));
        notice.setText(query.origin+" → "+query.destination+" · "+query.month+"\n휴대폰에서 대한항공에 직접 요청하는 중…"); notice.setTextColor(MUTED);
        final AwardClient request = new AwardClient(); client = request;
        // Whole-request deadline complements connection/read timeouts.
        final ScheduledFuture<?> deadline = timer.schedule(request::timeout,40,TimeUnit.SECONDS);
        worker.execute(() -> {
            AwardCore.CalendarResult data = null; AwardCore.Failure failure = null;
            try { data = request.fetch(query); } catch(AwardCore.Failure e) { failure = e; }
            deadline.cancel(false);
            final AwardCore.CalendarResult result = data; final AwardCore.Failure error = failure;
            runOnUiThread(() -> {
                if(dead) return; client = null; setBusy(false); results.setMinimumHeight(0);
                if(error!=null) { renderFailure(query,error); return; }
                current = result; selected = null; renderCalendar();
            });
        });
    }
    private void setBusy(boolean busy) {
        this.busy = busy;
        search.setEnabled(!busy); search.setText(busy?"조회 중…":"휴대폰에서 좌석 조회"); origin.setEnabled(!busy); destination.setEnabled(!busy); month.setEnabled(!busy); swap.setEnabled(!busy);
    }
    private boolean canChangeMonth(YearMonth target) {
        LocalDate today = AwardCore.today();
        return months.contains(target) && !target.isBefore(YearMonth.from(today)) && !target.isAfter(YearMonth.from(today.plusDays(359)));
    }
    private void changeMonth(AwardCore.Query displayed,int offset) {
        if(busy || dead) return;
        YearMonth target = displayed.month.plusMonths(offset);
        if(!canChangeMonth(target)) return;
        try {
            AwardCore.Query query = new AwardCore.Query(displayed.origin,displayed.destination,target,AwardCore.today());
            // Keep the displayed route and cabin; don't depend on Spinner callbacks to start a request.
            origin.setText(airportLabel(query.origin),false); destination.setText(airportLabel(query.destination),false);
            month.setSelection(months.indexOf(target));
            startSearch(query);
        } catch(AwardCore.Failure e) { Toast.makeText(this,e.getMessage(),Toast.LENGTH_LONG).show(); }
    }
    private void addMonthHeader(LinearLayout container,AwardCore.Query query) {
        container.addView(text(query.origin+" → "+query.destination,14,MUTED,true));
        LinearLayout navigation = row(); container.addView(navigation,space(dp(52),10));
        Button previous = button("‹",false); previous.setTextSize(28); previous.setContentDescription("이전 달");
        previous.setEnabled(!busy && canChangeMonth(query.month.minusMonths(1))); previous.setAlpha(previous.isEnabled()?1f:.3f);
        previous.setOnClickListener(v -> changeMonth(query,-1)); navigation.addView(previous,new LinearLayout.LayoutParams(dp(48),dp(48)));
        TextView title = text(query.month.getYear()+"년 "+query.month.getMonthValue()+"월",19,INK,true); title.setGravity(Gravity.CENTER);
        navigation.addView(title,new LinearLayout.LayoutParams(0,-2,1));
        Button next = button("›",false); next.setTextSize(28); next.setContentDescription("다음 달");
        next.setEnabled(!busy && canChangeMonth(query.month.plusMonths(1))); next.setAlpha(next.isEnabled()?1f:.3f);
        next.setOnClickListener(v -> changeMonth(query,1)); navigation.addView(next,new LinearLayout.LayoutParams(dp(48),dp(48)));
    }
    private void renderFailure(AwardCore.Query query,AwardCore.Failure error) {
        notice.setText("좌석 현황을 가져오지 못했습니다"); notice.setTextColor(AMBER);
        results.removeAllViews();
        LinearLayout box = card(); results.addView(box);
        addMonthHeader(box,query);
        box.addView(text(error.code,13,AMBER,true),space(0,16)); box.addView(text(error.getMessage(),16,INK,true),space(0,10));
        box.addView(text("조회가 실패했으므로 이 결과로 좌석 유무를 판단할 수 없습니다.",14,MUTED,false),space(0,10));
        String time = DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm:ss").withZone(AwardCore.KOREA).format(Instant.now());
        errorText = "마일리지 달력 0.1.2\n"+query.origin+" → "+query.destination+" / "+query.month+"\n"+time+" KST\n"+error.code+"\n"+error.getMessage();
        Button copy = button("오류 정보 복사",false); box.addView(copy,space(dp(48),14)); copy.setOnClickListener(v -> {
            ((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("좌석 조회 오류",errorText)); Toast.makeText(this,"오류 정보를 복사했습니다",Toast.LENGTH_SHORT).show();
        });
    }
    private String chosenCabin() { return CODES[cabin.getSelectedItemPosition()]; }
    private static int cabinColor(String code) {
        switch(code) { case "X": return BLUE; case "N": case "P": return PREMIUM; case "O": case "Z": return PRESTIGE; case "A": return FIRST; default: return INK; }
    }
    private static int cabinTint(String code) {
        int color = cabinColor(code);
        return Color.rgb((Color.red(color)+9*255)/10,(Color.green(color)+9*255)/10,(Color.blue(color)+9*255)/10);
    }
    private void addCabinLegend(LinearLayout container) {
        String[] labels = {"일반석", "프리미엄석", "프레스티지석", "일등석"};
        for(int i=0;i<4;i+=2) {
            LinearLayout line = row(); container.addView(line,space(0,i==0?12:6));
            for(int j=i;j<i+2;j++) line.addView(text("● "+labels[j],12,cabinColor(CODES[j+1]),true),new LinearLayout.LayoutParams(0,-2,1));
        }
        container.addView(text("색 점: 가능 표시 · —: 표시 없음 · ?: 자료 없음\n일등석은 보너스·승급 통합 표시",11,MUTED,false),space(0,8));
    }
    private View dayCell(AwardCore.Day day,String filter,boolean active) {
        int state = day.indicator(filter); boolean picked = day.date.equals(selected);
        LinearLayout cell = column(); cell.setGravity(Gravity.CENTER); cell.setPadding(0,dp(4),0,dp(4));
        int accent = filter.equals("all")?INK:cabinColor(filter);
        cell.setBackground(shape(picked?cabinTint(filter):active&&state==1?cabinTint(filter):Color.WHITE,dp(8),picked?accent:0));
        TextView date = text(String.valueOf(day.date.getDayOfMonth()),14,active?(state==1?accent:INK):Color.LTGRAY,true);
        date.setGravity(Gravity.CENTER); date.setIncludeFontPadding(false); cell.addView(date);
        LinearLayout markers = row(); markers.setGravity(Gravity.CENTER); cell.addView(markers,new LinearLayout.LayoutParams(-1,dp(20)));
        StringBuilder description = new StringBuilder(day.date.toString());
        if(active && state==1) {
            // Fixed left-to-right slots match the legend, even when one class has no indicator.
            int start = filter.equals("all")?1:Arrays.asList(CODES).indexOf(filter);
            int end = filter.equals("all")?4:start;
            for(int i=start;i<=end;i++) {
                boolean available = day.indicator(CODES[i])==1;
                View dot = new View(this); dot.setBackground(shape(available?cabinColor(CODES[i]):Color.TRANSPARENT,dp(3),0));
                LinearLayout.LayoutParams dotSize = new LinearLayout.LayoutParams(dp(6),dp(6)); dotSize.setMargins(dp(1),0,dp(1),0); markers.addView(dot,dotSize);
                if(available) description.append(" · ").append(CABINS[i]).append(" 가능 표시");
            }
        } else {
            TextView marker = text(active?(state==0?"—":"?"):"",12,state==0?MUTED:AMBER,true); markers.addView(marker);
            description.append(active?(state==0?" · 가능 표시 없음":" · 공개 자료 없음"):" · 조회 범위 밖");
        }
        cell.setEnabled(active); cell.setContentDescription(description.toString());
        cell.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        date.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO); markers.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        if(active) { cell.setClickable(true); cell.setFocusable(true); cell.setOnClickListener(v->{selected=day.date;renderCalendar();}); }
        return cell;
    }
    private void renderCalendar() {
        if(current==null) return;
        results.removeAllViews(); LocalDate today = AwardCore.today(); String code = chosenCabin(); int yes=0,unknown=0;
        for(AwardCore.Day day:current.days) if(AwardCore.inRange(day.date,today)) { if(day.indicator(code)==1) yes++; if(day.indicator(code)==-1) unknown++; }
        notice.setText("대한항공 응답 확인 · "+DateTimeFormatter.ofPattern("MM.dd HH:mm:ss").withZone(AwardCore.KOREA).format(current.fetchedAt)+" KST\n표시된 시각에 받은 현황입니다."); notice.setTextColor(MUTED);
        LinearLayout calendar = card(); results.addView(calendar);
        addMonthHeader(calendar,current.query);
        calendar.addView(text(CABINS[cabin.getSelectedItemPosition()]+" · 가능 표시 "+yes+"일"+(unknown>0?" · 자료 없음 "+unknown+"일":""),13,cabinColor(code),true),space(0,8));
        addCabinLegend(calendar);
        String[] weekdays = {"일","월","화","수","목","금","토"}; LinearLayout week = row(); calendar.addView(week,space(0,14));
        for(String name:weekdays) { TextView label=text(name,12,MUTED,true);label.setGravity(Gravity.CENTER);week.addView(label,new LinearLayout.LayoutParams(0,dp(28),1)); }
        int offset=current.query.month.atDay(1).getDayOfWeek().getValue()%7, count=current.days.size(), slots=((offset+count+6)/7)*7;
        LinearLayout line=null;
        for(int i=0;i<slots;i++) {
            if(i%7==0) { line=row();calendar.addView(line,space(dp(58),3)); }
            int index=i-offset;
            if(index<0||index>=count) { line.addView(new View(this),new LinearLayout.LayoutParams(0,dp(58),1));continue; }
            AwardCore.Day day=current.days.get(index);boolean active=AwardCore.inRange(day.date,today);
            View cell=dayCell(day,code,active);
            LinearLayout.LayoutParams cellParams=new LinearLayout.LayoutParams(0,dp(58),1);cellParams.setMargins(dp(1),0,dp(1),0);line.addView(cell,cellParams);
        }
        details=card();results.addView(details,space(0,14));
        if(selected==null) details.addView(text("날짜를 누르면 항공편과 예매 바로가기가 표시됩니다.",14,MUTED,false));
        else for(AwardCore.Day day:current.days) if(day.date.equals(selected)) showDetails(day);
    }
    private void showDetails(AwardCore.Day day) {
        details.addView(text(day.date.getMonthValue()+"월 "+day.date.getDayOfMonth()+"일",21,INK,true));
        if(!day.verified) details.addView(text("이 날짜의 공개 자료가 없습니다. 예약 가능 여부는 확인되지 않았습니다.",14,AMBER,false),space(0,12));
        else if(day.flights.isEmpty()) details.addView(text("공개 응답에 항공편이 없습니다.",14,MUTED,false),space(0,12));
        for(AwardCore.Flight flight:day.flights) {
            details.addView(text(flight.number+"  ·  "+flight.time+" 출발",17,INK,true),space(0,18));
            for(int i=0;i<AwardCore.CLASS_CODES.length;i++) {
                Boolean available=flight.status.get(AwardCore.CLASS_CODES[i]); if(available==null) continue;
                String code = AwardCore.CLASS_CODES[i];
                String marker = available?(code.equals("P")||code.equals("Z")?"◇ ":"● "):"— ";
                details.addView(text(marker+AwardCore.CLASS_NAMES[i]+(available?"  가능 표시":"  표시 없음"),13,available?cabinColor(code):MUTED,false),space(0,6));
            }
        }
        Button booking=button("이 날짜로 대한항공 예매 열기 ↗",true);details.addView(booking,space(dp(56),20));
        booking.setOnClickListener(v->{
            if(chosenCabin().equals("all")) new AlertDialog.Builder(this).setTitle("예약할 좌석 등급").setItems(new String[]{"일반석","프리미엄석","프레스티지석","일등석"},(dialog,which)->openBooking(day.date,CODES[which+1])).show();
            else openBooking(day.date,chosenCabin());
        });
        details.addView(text("대한항공에서 로그인 후 날짜·탑승객·좌석 등급을 확인해 주세요. 예약은 대한항공에서 진행합니다.",12,MUTED,false),space(0,12));
    }
    private void openBooking(LocalDate date,String klass) {
        try { open(AwardCore.bookingUrl(current.query,date,klass,AwardCore.today())); }
        catch(AwardCore.Failure e) { Toast.makeText(this,e.getMessage(),Toast.LENGTH_LONG).show(); }
    }
    private void open(String url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url))); }
        catch(ActivityNotFoundException e) { Toast.makeText(this,"링크를 열 브라우저가 설치되어 있지 않습니다.",Toast.LENGTH_LONG).show(); }
    }
    private int dp(int value) { return Math.round(getResources().getDisplayMetrics().density*value); }
    private LinearLayout column() { LinearLayout v=new LinearLayout(this);v.setOrientation(LinearLayout.VERTICAL);return v; }
    private LinearLayout row() { LinearLayout v=new LinearLayout(this);v.setOrientation(LinearLayout.HORIZONTAL);v.setGravity(Gravity.CENTER_VERTICAL);return v; }
    private LinearLayout card() { LinearLayout v=column();v.setPadding(dp(16),dp(20),dp(16),dp(20));v.setBackground(shape(Color.WHITE,dp(18),0));return v; }
    private TextView text(String value,int size,int color,boolean bold) { TextView v=new TextView(this);v.setText(value);v.setTextSize(size);v.setTextColor(color);v.setLineSpacing(dp(3),1);if(bold)v.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return v; }
    private GradientDrawable shape(int color,int radius,int stroke) { GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(radius);if(stroke!=0)d.setStroke(dp(2),stroke);return d; }
    private Button button(String title,boolean primary) { Button b=new Button(this);b.setText(title);b.setTextSize(14);b.setAllCaps(false);b.setTypeface(Typeface.DEFAULT,Typeface.BOLD);b.setTextColor(primary?Color.WHITE:BLUE);b.setBackground(shape(primary?BLUE:Color.rgb(235,242,255),dp(12),0));b.setPadding(dp(8),dp(6),dp(8),dp(6));b.setMinHeight(dp(48));return b; }
    private Spinner spinner(String[] labels) { Spinner s=new Spinner(this,Spinner.MODE_DROPDOWN);ArrayAdapter<String>a=new ArrayAdapter<>(this,android.R.layout.simple_spinner_item,labels);a.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);s.setAdapter(a);s.setMinimumHeight(dp(52));s.setBackground(shape(BG,dp(10),0));return s; }
    private Spinner cabinSpinner() {
        Spinner s = spinner(CABINS);
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,CABINS) {
            private View styled(View view,int position) {
                TextView label = (TextView)view; label.setText((position==0?"":"● ")+CABINS[position]); label.setTextColor(cabinColor(CODES[position])); return view;
            }
            @Override public View getView(int position,View convertView,ViewGroup parent) { return styled(super.getView(position,convertView,parent),position); }
            @Override public View getDropDownView(int position,View convertView,ViewGroup parent) { return styled(super.getDropDownView(position,convertView,parent),position); }
        };
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item); s.setAdapter(adapter); return s;
    }
    private LinearLayout.LayoutParams space(int height,int top) { LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,height==0?-2:height);p.topMargin=dp(top);return p; }
    @Override protected void onDestroy() { dead=true;AwardClient request=client;if(request!=null)request.cancel();worker.shutdownNow();timer.shutdownNow();super.onDestroy(); }
}
