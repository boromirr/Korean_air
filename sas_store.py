"""Local SAS snapshots. Store flight fields only; never accept browser/account dumps."""
from datetime import datetime, timezone
from pathlib import Path
import json
import re
import sqlite3

SOURCE = 'SAS_EUROBONUS_VISIBLE_RESULTS'
CABINS = {'economy', 'premium economy', 'business', 'first'}


def validated(raw):
    if not isinstance(raw, dict) or raw.get('source') != SOURCE:
        raise ValueError('source')
    for key in ('origin', 'destination'):
        if not isinstance(raw.get(key), str) or not re.fullmatch('[A-Z]{3}', raw[key]):
            raise ValueError('airport')
    if raw['origin'] == raw['destination']:
        raise ValueError('route')
    day = raw.get('date')
    if not isinstance(day, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day):
        raise ValueError('date')
    datetime.strptime(day, '%Y-%m-%d')
    observed = raw.get('observedAt')
    if not isinstance(observed, str) or len(observed) > 40:
        raise ValueError('timestamp')
    stamp = datetime.fromisoformat(observed.replace('Z', '+00:00'))
    if not stamp.tzinfo or stamp.timestamp() > datetime.now(timezone.utc).timestamp()+300:
        raise ValueError('timestamp')
    if type(raw.get('adults')) is not int or raw.get('adults') != 1 or raw.get('tripType') != 'ONE_WAY':
        raise ValueError('passengers')
    for field in ('complete', 'freshSearch'):
        if type(raw.get(field)) is not bool:
            raise ValueError(field)
    status = raw.get('status')
    flights = raw.get('flights')
    if status not in ('available', 'empty') or not isinstance(flights, list) or len(flights) > 250:
        raise ValueError('flights')
    if (status == 'empty') != (len(flights) == 0):
        raise ValueError('status')
    if status == 'empty' and (not raw['complete'] or not raw['freshSearch']):
        raise ValueError('unverified empty')
    safe_flights = []
    for flight in flights:
        if not isinstance(flight, dict):
            raise ValueError('flight')
        item = {}
        for field in ('departureTime', 'arrivalTime'):
            value = flight.get(field)
            if not isinstance(value, str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', value):
                raise ValueError('time')
            item[field] = value
        for field, limit in (('itinerary', 500), ('operatedBy', 300)):
            value = flight.get(field)
            if not isinstance(value, str) or not value.strip() or len(value)>limit or any(ord(c)<32 for c in value):
                raise ValueError('label')
            item[field] = value
        fares = flight.get('fares')
        if not isinstance(fares, list) or len(fares)>4:
            raise ValueError('fares')
        item['fares'] = []
        seen = set()
        for fare in fares:
            if not isinstance(fare, dict) or not isinstance(fare.get('cabin'),str) or fare['cabin'] not in CABINS or fare['cabin'] in seen:
                raise ValueError('cabin')
            seen.add(fare['cabin'])
            if type(fare.get('points')) is not int or not 0 < fare['points'] <= 100000000:
                raise ValueError('points')
            item['fares'].append({'cabin':fare['cabin'], 'points':fare['points'], 'availableSeatCount':None})
        safe_flights.append(item)
    return {'source':SOURCE,'origin':raw['origin'],'destination':raw['destination'],'date':day,
            'observedAt':stamp.astimezone(timezone.utc).isoformat(),'status':status,'complete':raw['complete'],
            'freshSearch':raw['freshSearch'],'adults':1,'tripType':'ONE_WAY','flights':safe_flights}


class SasStore:
    def __init__(self, root):
        self.path = Path(root) / 'data' / 'local' / 'sas.sqlite3'

    def save(self, raw):
        value = validated(raw)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(str(self.path), timeout=5) as db:
            db.execute('CREATE TABLE IF NOT EXISTS snapshots (origin TEXT, destination TEXT, day TEXT, observed TEXT, payload TEXT, PRIMARY KEY(origin,destination,day))')
            db.execute('INSERT INTO snapshots VALUES (?,?,?,?,?) ON CONFLICT(origin,destination,day) DO UPDATE SET observed=excluded.observed,payload=excluded.payload WHERE excluded.observed >= snapshots.observed',
                       (value['origin'],value['destination'],value['date'],value['observedAt'],json.dumps(value,ensure_ascii=False)))
        return value

    def list(self):
        if not self.path.exists():
            return []
        with sqlite3.connect(str(self.path), timeout=5) as db:
            values = db.execute('SELECT payload FROM snapshots ORDER BY day,origin,destination LIMIT 1000').fetchall()
        return [json.loads(row[0]) for row in values]
