import tempfile
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock
from award_service import plan, month_days, AwardService
from sas_service import SasError

TODAY=date(2026,9,10)
def query(**kw):
    q=dict(program='asiana-club',origin='ICN',destination='NRT',month='2026-11',tripType='ONE_WAY',cabin='all');q.update(kw);return q

class MonthPlanTests(unittest.TestCase):
    def test_year_boundary_and_horizon(self):
        self.assertEqual(len(month_days('2027-01',TODAY)),31)
        self.assertEqual(month_days('2026-09',TODAY)[0],'2026-09-10')
        self.assertEqual(month_days('2027-09',TODAY)[-1],'2027-09-04')
        with self.assertRaises(SasError):month_days('2027-10',TODAY)
    def test_roundtrip_reverses_route(self):
        p,legs=plan(query(tripType='ROUND_TRIP',returnMonth='2026-12'),TODAY)
        self.assertEqual((legs[1]['origin'],legs[1]['destination']),('NRT','ICN'))
        self.assertEqual(sum(len(l['days']) for l in legs),61)
    def test_skyteam_requires_roundtrip_and_documents_reference_dates(self):
        with self.assertRaisesRegex(SasError,'ROUND_TRIP_REQUIRED'):plan(query(program='skyteam'),TODAY)
        p,legs=plan(query(program='skyteam',tripType='ROUND_TRIP',returnMonth='2026-11'),TODAY)
        self.assertEqual(legs[0]['referenceDate'],'2026-11-30')
        self.assertEqual(legs[1]['referenceDate'],'2026-11-01')
        self.assertEqual(legs[1]['days'][0]['date'],'2026-11-02')
    def test_unsupported_cabin_is_not_reported_empty(self):
        with self.assertRaises(SasError):plan(query(cabin='first'),TODAY)

class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.service=AwardService(self.tmp.name,SimpleNamespace(thread=None),interval=0)
        self.service.worker=Mock()
    def job(self,program='asiana-club'):
        p,legs=plan(query(program=program),TODAY)
        return dict(params=p,legs=legs,status='running',completed=0,total=30,code=None)
    def test_incomplete_calendar_keeps_missing_dates_unsearched(self):
        job=self.job();self.service.worker.call.return_value=dict(origin='ICN',destination='NRT',month='2026-11',status='complete',observedAt='2026-09-10T00:00:00Z',days=[dict(date='2026-11-01',status='empty',cabins=[],flights=[])])
        self.service._run(job)
        self.assertEqual(job['status'],'partial');self.assertEqual(job['completed'],1)
        self.assertEqual(job['legs'][0]['days'][1]['status'],'unsearched')
    def test_failed_search_is_not_empty(self):
        job=self.job('star-alliance');self.service.worker.call.return_value=dict(status='failed',code='ACCESS_RESTRICTED')
        self.service._run(job)
        self.assertEqual(job['status'],'failed');self.assertEqual(job['completed'],0)
        self.assertEqual(job['legs'][0]['days'][0]['status'],'failed')
        self.assertEqual(job['legs'][0]['days'][1]['status'],'unsearched')
    def test_wrong_route_result_is_rejected(self):
        job=self.job('star-alliance');self.service.worker.call.return_value=dict(origin='LAX',destination='NRT',date='2026-11-01',status='available')
        self.service._run(job);self.assertEqual(job['code'],'QUERY_MISMATCH')
    def test_cancelling_another_program_does_not_stop_active_job(self):
        self.assertEqual(self.service.cancel('skyteam'),{'status':'idle'})
        self.assertFalse(self.service.stop.is_set())
    def test_sas_roundtrip_searches_every_day_with_reversed_route(self):
        from test_sas_store import sample
        p,legs=plan(query(program='sas-eurobonus',tripType='ROUND_TRIP',returnMonth='2026-11'),TODAY)
        job=dict(params=p,legs=legs,status='running',completed=0,total=60,code=None)
        self.service.sas=SimpleNamespace(worker=Mock(),store=Mock())
        def search(action,q):
            result=sample();result.update(q,freshSearch=True);return result
        self.service.sas.worker.call.side_effect=search
        self.service._run(job)
        self.assertEqual(job['status'],'complete')
        self.assertEqual(job['completed'],60)
        self.assertEqual(self.service.sas.worker.call.call_args_list[30].args[1],dict(origin='NRT',destination='ICN',date='2026-11-01'))
        self.assertEqual(job['legs'][1]['days'][0]['flights'][0]['cabin'],'business')
