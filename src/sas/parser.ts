const cabins = ['economy', 'premium economy', 'business', 'first'];
export function parseSasRow(text: string) {
  const lines=text.split(/\n/).map(x=>x.trim()).filter(Boolean);
  const times=text.match(/\b(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})\b/);
  const operated=lines.filter(x=>/^Operated by /i.test(x));
  if(!times || !operated.length) throw new Error('UNRECOGNIZED_RESULT');
  const fares: {cabin:string,points:number,availableSeatCount:null}[]=[];
  for(let i=0;i<lines.length;i++) {
    const cabin=lines[i].toLowerCase();if(!cabins.includes(cabin))continue;
    const amount=(lines[i+1]||'').match(/^([\d,\s]+)\s*p$/i);
    if(!amount) {if(/^not available$/i.test(lines[i+1]||''))continue;throw new Error('UNRECOGNIZED_RESULT');}
    const points=Number(amount[1].replace(/[,\s]/g,''));
    if(!Number.isSafeInteger(points)||points<=0)throw new Error('UNRECOGNIZED_RESULT');
    fares.push({cabin,points,availableSeatCount:null});
  }
  if(!fares.length&&!/Not available/i.test(text))throw new Error('UNRECOGNIZED_RESULT');
  return {departureTime:times[1],arrivalTime:times[2],
    itinerary:lines.slice(0,lines.findIndex(x=>/^Operated by /i.test(x))+1).join(' · ').slice(0,500),
    operatedBy:operated.join(' / ').slice(0,300),fares};
}
