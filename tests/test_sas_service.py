import tempfile
import time
import unittest
from datetime import date
from unittest.mock import Mock, patch
from sas_service import SasService, SasError, validate_queries
from sas_store import SasStore
from test_sas_store import sample


class SasServiceTests(unittest.TestCase):
    def setUp(self):
        fixed = patch("sas_service.validate_queries", side_effect=lambda items: validate_queries(items,date(2026,9,10)))
        fixed.start(); self.addCleanup(fixed.stop)

    def test_query_scope_and_dates(self):
        q={'origin':'AMS','destination':'CDG','date':'2026-11-04'}
        self.assertEqual(validate_queries([q,q],date(2026,9,10)),[q])
        for value in ([],[q]*21,[dict(q,date='2026-02-31')],[dict(q,destination='AMS')],[dict(q,date='2028-01-01')],{}):
            with self.subTest(value=value),self.assertRaises(SasError):validate_queries(value,date(2026,9,10))

    def service(self, results):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        worker=Mock();worker.call.side_effect=results
        return SasService(temp.name,SasStore(temp.name),worker,interval=0)

    def finish(self, service):
        service.thread.join(timeout=2)
        self.assertFalse(service.thread.is_alive())

    def test_verified_receipt_saved_only_for_requested_query(self):
        receipt=sample();receipt['freshSearch']=True
        service=self.service([receipt])
        service.start([{'origin':'AMS','destination':'CDG','date':'2026-11-04'}]);self.finish(service)
        self.assertEqual(service.job['status'],'complete')
        self.assertEqual(len(service.store.list()),1)
        receipt=sample();receipt['freshSearch']=True;receipt['destination']='JFK'
        service=self.service([receipt])
        service.start([{'origin':'AMS','destination':'CDG','date':'2026-11-04'}]);self.finish(service)
        self.assertEqual(service.job['code'],'QUERY_MISMATCH')
        self.assertEqual(service.store.list(),[])

    def test_login_or_browser_failure_stops_remaining_queries_without_empty_data(self):
        service=self.service([{'status':'failed','code':'LOGIN_REQUIRED'}])
        service.start([{'origin':'AMS','destination':'CDG','date':'2026-11-04'},{'origin':'AMS','destination':'CDG','date':'2026-11-05'}]);self.finish(service)
        self.assertEqual(service.job['status'],'failed');self.assertEqual(service.job['index'],1)
        self.assertEqual(service.store.list(),[]);self.assertEqual(service.worker.call.call_count,1)

    def test_repeated_query_calls_airline_again_instead_of_reusing_saved_result(self):
        first=sample();first['freshSearch']=True
        second=sample();second['freshSearch']=True
        second['flights'][0]['fares'][0]['points']=32000
        service=self.service([first,second])
        query={'origin':'AMS','destination':'CDG','date':'2026-11-04'}
        service.start([query]);self.finish(service)
        service.start([query]);self.finish(service)
        self.assertEqual(service.worker.call.call_count,2)
        self.assertEqual(service.job['status'],'complete')
        self.assertEqual(len(service.store.list()),1)
        self.assertEqual(service.store.list()[0]['flights'][0]['fares'][0]['points'],32000)
