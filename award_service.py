"""Month plans and explicit per-day progress for local airline searches."""
import calendar
import copy
import json
import re
import threading
from datetime import date,timedelta
from pathlib import Path
from sas_service import SasWorker,SasError
from sas_store import validated

PROGRAMS=('sas-eurobonus','asiana-club','skyteam','star-alliance')
CABINS=('all','economy','premium economy','business','first')

def month_days(month,today=None):
    today=today or date.today()
    if not isinstance(month,str) or not re.fullmatch(r'\d{4}-\d{2}',month):raise SasError('INVALID_QUERY')
    try:
        first=date.fromisoformat(month+'-01')
        days=[first+timedelta(days=i) for i in range(calendar.monthrange(first.year,first.month)[1])]
    except ValueError:raise SasError('INVALID_QUERY')
    days=[d.isoformat() for d in days if today<=d<=today+timedelta(days=359)]
    if not days:raise SasError('INVALID_QUERY')
    return days

def plan(raw,today=None):
    if not isinstance(raw,dict) or raw.get('program') not in PROGRAMS:raise SasError('INVALID_QUERY')
    for k in ('origin','destination'):
        if not isinstance(raw.get(k),str) or not re.fullmatch('[A-Z]{3}',raw[k]):raise SasError('INVALID_QUERY')
    if raw['origin']==raw['destination'] or raw.get('tripType') not in ('ONE_WAY','ROUND_TRIP') or raw.get('cabin') not in CABINS:raise SasError('INVALID_QUERY')
    if raw['program']=='skyteam' and raw['tripType']!='ROUND_TRIP':raise SasError('ROUND_TRIP_REQUIRED')
    if raw['program']!='sas-eurobonus' and raw['cabin']=='premium economy':raise SasError('INVALID_QUERY')
    if raw['program']=='asiana-club' and raw['cabin']=='first':raise SasError('INVALID_QUERY')
    p={k:raw[k] for k in ('program','origin','destination','month','tripType','cabin') if k in raw}
    outbound=month_days(raw.get('month'),today)
    legs=[{'direction':'outbound','origin':p['origin'],'destination':p['destination'],'month':raw['month'],'days':[{'date':d,'status':'unsearched','cabins':[],'flights':[]} for d in outbound]}]
    if p['tripType']=='ROUND_TRIP':
        inbound=month_days(raw.get('returnMonth'),today)
        if inbound[-1]<outbound[0]:raise SasError('INVALID_QUERY')
        p['returnMonth']=raw['returnMonth']
        legs.append({'direction':'inbound','origin':p['destination'],'destination':p['origin'],'month':p['returnMonth'],'days':[{'date':d,'status':'unsearched','cabins':[],'flights':[]} for d in inbound]})
    if p['program']=='skyteam':
        # Partner booking requires a return date and a selected outbound flight.
        last_return=legs[1]['days'][-1]['date']
        first_out=legs[0]['days'][0]['date']
        legs[0]['days']=[d for d in legs[0]['days'] if d['date']<last_return]
        legs[1]['days']=[d for d in legs[1]['days'] if d['date']>first_out]
        if not all(l['days'] for l in legs):raise SasError('INVALID_QUERY')
        legs[0]['referenceDate']=last_return
        legs[1]['referenceDate']=first_out
    return p,legs

class AwardService:
    def __init__(self,root,sas_service,interval=30):
        self.root=Path(root);self.sas=sas_service;self.worker=SasWorker(root,'scripts/award-browser.ts');self.interval=interval
        self.lock=threading.RLock();self.stop=threading.Event();self.jobs={};self.thread=None
    def status(self,program):
        if program not in PROGRAMS:raise SasError('INVALID_QUERY')
        browser=self.sas.worker.call('status',timeout=5) if program=='sas-eurobonus' else self.worker.call('status',timeout=5,program=program)
        with self.lock:return {'browser':browser,'job':copy.deepcopy(self.jobs.get(program))}
    def open(self,program):
        if program not in PROGRAMS+('korean-air',):raise SasError('INVALID_QUERY')
        if program=='sas-eurobonus':return self.sas.open()
        browser=self.worker.call('open',timeout=60,program=program)
        if browser.get('status')=='failed':raise SasError(browser.get('code','BROWSER_ERROR'))
        return {'browser':browser}
    def start(self,raw):
        p,legs=plan(raw)
        with self.lock:
            if self.thread and self.thread.is_alive():raise SasError('BUSY')
            if self.sas.thread and self.sas.thread.is_alive():raise SasError('BUSY')
            self.stop.clear();job={'params':p,'legs':legs,'status':'running','completed':0,'total':sum(len(l['days']) for l in legs),'code':None}
            self.jobs[p['program']]=job
            self.thread=threading.Thread(target=self._run,args=(job,),daemon=True);self.thread.start()
            return {'job':copy.deepcopy(job)}
    def _run(self,job):
        program=job['params']['program']
        try:
            for leg in job['legs']:
                if self.stop.is_set():return
                if program=='asiana-club':
                    r=self.worker.call('search', {k:leg[k] for k in ('origin','destination','month')},program=program)
                    if self.stop.is_set():return
                    if r.get('status')=='failed':raise SasError(r.get('code','SEARCH_FAILED'))
                    if any(r.get(k)!=leg[k] for k in ('origin','destination','month')):raise SasError('QUERY_MISMATCH')
                    bydate={d['date']:d for d in r['days']}
                    with self.lock:
                        for d in leg['days']:
                            if d['date'] in bydate:d.update(bydate[d['date']]);d['observedAt']=r['observedAt'];d['sourceAt']=r.get('sourceAt');job['completed']+=1
                    self._save(job)
                else:
                    for day in leg['days']:
                        if self.stop.is_set():return
                        q={'origin':leg['origin'],'destination':leg['destination'],'date':day['date']}
                        with self.lock:day['status']='searching'
                        if program=='sas-eurobonus':
                            r=self.sas.worker.call('search',q)
                            if r.get('status')=='failed':raise SasError(r.get('code','SEARCH_FAILED'))
                            r=validated(r)
                            if any(r[k]!=v for k,v in q.items()) or not r['freshSearch']:raise SasError('QUERY_MISMATCH')
                            self.sas.store.save(r)
                            flights=[dict(fare,departureTime=f['departureTime'],operatedBy=f['operatedBy'],itinerary=f['itinerary']) for f in r['flights'] for fare in f['fares']]
                            result={'status':'available' if flights else 'empty','cabins':list(set(f['cabin'] for f in flights)),'flights':flights,'observedAt':r['observedAt']}
                        else:
                            search_q=dict(q,cabin=job['params']['cabin'])
                            if program=='skyteam':
                                search_q.update(origin=job['params']['origin'],destination=job['params']['destination'],direction=leg['direction'],date=day['date'] if leg['direction']=='outbound' else leg['referenceDate'],returnDate=leg['referenceDate'] if leg['direction']=='outbound' else day['date'])
                            r=self.worker.call('search',search_q,program=program,timeout=480 if program=='skyteam' else 180)
                            if r.get('status')=='failed':raise SasError(r.get('code','SEARCH_FAILED'))
                            if any(r.get(k)!=v for k,v in q.items()):raise SasError('QUERY_MISMATCH')
                            if r.get('status') not in ('available','empty','partial'):raise SasError('UNRECOGNIZED_RESULT')
                            result=r
                        if self.stop.is_set():return
                        with self.lock:day.update(result);job['completed']+=1
                        self._save(job)
                        if result.get('status')=='partial' and result.get('code')!='REFERENCE_UNAVAILABLE':raise SasError(result.get('code','UNRECOGNIZED_RESULT'))
                        if job['completed']<job['total'] and self.stop.wait(self.interval):return
            with self.lock:job['status']='complete' if job['completed']==job['total'] and all(d['status'] in ('available','empty') for leg in job['legs'] for d in leg['days']) else 'partial'
            self._save(job)
        except Exception as e:
            with self.lock:
                if self.stop.is_set():return
                job['status']='failed';job['code']=e.code if isinstance(e,SasError) else 'SEARCH_FAILED'
                for leg in job['legs']:
                    for d in leg['days']:
                        if d['status']=='searching':d['status']='failed'
    def _save(self,job):
        p=self.root/'data/local/month-results';p.mkdir(parents=True,exist_ok=True)
        (p/(job['params']['program']+'.json')).write_text(json.dumps(job,ensure_ascii=False),encoding='utf-8')
    def cancel(self,program):
        if program not in PROGRAMS:raise SasError('INVALID_QUERY')
        with self.lock:
            j=self.jobs.get(program)
            if not j or j['status']!='running':return {'status':'idle'}
        self.stop.set()
        if program=='sas-eurobonus':self.sas.worker.call('cancel',timeout=5)
        else:self.worker.call('cancel',timeout=5,program=program)
        with self.lock:
            j=self.jobs.get(program)
            if j and j['status']=='running':
                j['status']='cancelled'
                for leg in j['legs']:
                    for d in leg['days']:
                        if d['status']=='searching':d['status']='unsearched'
                self._save(j)
        return {'status':'cancelled'}
    def close(self):self.stop.set();self.worker.close()
