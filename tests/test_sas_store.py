import copy
import tempfile
import unittest
from sas_store import SasStore, validated, SOURCE


def sample():
    return {'source':SOURCE,'origin':'AMS','destination':'CDG','date':'2026-11-04',
            'observedAt':'2026-09-10T00:00:00Z','status':'available','complete':True,'freshSearch':False,
            'adults':1,'tripType':'ONE_WAY','account':'must not be stored',
            'flights':[{'departureTime':'06:55','arrivalTime':'08:10','itinerary':'Direct, 1h 15m',
                        'operatedBy':'Operated by TEST (AMS-CDG)',
                        'fares':[{'cabin':'business','points':48000,'availableSeatCount':99}]}]}


class SasStoreTests(unittest.TestCase):
    def test_only_allowlisted_fields_and_no_inferred_seat_count(self):
        result=validated(sample())
        self.assertNotIn('account', result)
        self.assertIsNone(result['flights'][0]['fares'][0]['availableSeatCount'])

    def test_empty_must_be_new_completed_search(self):
        value=sample();value.update(status='empty',flights=[])
        with self.assertRaises(ValueError): validated(value)
        value['freshSearch']=True
        self.assertEqual(validated(value)['status'],'empty')
        value['complete']=False
        with self.assertRaises(ValueError): validated(value)

    def test_invalid_or_failed_data_never_becomes_empty(self):
        for key,value in [('status','failed'),('date','2026-02-31'),('origin','../'),('flights',[]),('source','OTHER'),('complete',1),('adults',2)]:
            data=sample();data[key]=value
            with self.subTest(key=key), self.assertRaises(ValueError): validated(data)

    def test_duplicate_import_and_older_capture_do_not_replace_newer(self):
        with tempfile.TemporaryDirectory() as root:
            store=SasStore(root); self.assertEqual(store.list(),[])
            data=sample();store.save(data);store.save(data)
            old=copy.deepcopy(data);old['observedAt']='2026-09-09T00:00:00Z';old['flights'][0]['fares'][0]['points']=9999
            store.save(old)
            self.assertEqual(len(store.list()),1)
            self.assertEqual(store.list()[0]['flights'][0]['fares'][0]['points'],48000)
            data['date']='2026-11-05';store.save(data)
            self.assertEqual(len(store.list()),2)
