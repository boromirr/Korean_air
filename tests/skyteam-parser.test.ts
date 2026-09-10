import {describe,it,expect} from 'vitest';
import {parseSkyFlights} from '../src/partners/skyteam.js';
const label='KE703, 대한항공 운항, 출발시간 09:55, 출발지 ICN, 도착시간 12:25, 도착지 NRT, 소요시간 02시간 30분';
describe('SkyTeam visible flight labels',()=>{
  it('extracts displayed flights without inventing seats or mileage',()=>{
    expect(parseSkyFlights([label],'ICN','NRT','economy')[0]).toEqual({flightNumber:'KE703',cabin:'economy',departureTime:'09:55',arrivalTime:'12:25',points:null,availableSeatCount:null});
  });
  it('rejects another direction and unexpected labels',()=>{
    expect(()=>parseSkyFlights([label],'NRT','ICN','economy')).toThrow('QUERY_MISMATCH');
    expect(()=>parseSkyFlights(['Error'],'ICN','NRT','economy')).toThrow('QUERY_MISMATCH');
  });
});
