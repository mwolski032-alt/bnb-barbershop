// Isolated interactive QA of the reviews and of the end-of-day window. Data lives in memory only; this
// server never connects to production or authenticates a user. Run `npm run build` first (it reads the CSS).
//   /          salon page with the "Opinie" card and its dialog
//   /prompt    the review form of a settled visit
//   /unsettled the barber's end-of-day window
//   /success   the booking confirmation with the "Dodaj do kalendarza" button
//   /wizard    the real booking wizard (the waitlist card is on its calendar step)
//   /days      the waitlist day picker, laid out like the barber's
import { build } from "esbuild";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const firebaseMock = `
export const ref=(_,path)=>path;
export const get=async()=>({val:()=>"ul. Przykładowa 1, Włodawa"});
export function onValue(_,cb){cb({val:()=>({gallery:{},settings:{address:'ul. Przykładowa 1',openingHours:'Pon-Pt 10-19'}})});return ()=>{}}
`;
const bundle = await build({
  stdin: { resolveDir: root, loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Home from './app/components/salon-home';
    import ReviewPrompt from './app/components/review-prompt';
    import UnsettledDialog from './app/components/unsettled-dialog';
    import SuccessScreen from './app/components/screens/success-screen';
    import Wizard from './tests/visual/booking-wizard-preview';
    import DayPicker from './app/components/day-picker';
    function Days(){ const [dates,setDates]=React.useState(['2026-10-12','2026-10-13']); return <div style={{maxWidth:460,margin:'20px auto',padding:12}}><div className='work-editor-card waitlist-planner'><div className='wk-block'><h3 className='wk-step-title'><b>1</b>Wybierz dni</h3><DayPicker selected={dates} onChange={setDates} today={new Date(2026,9,10)} lastKey='2026-12-09'/></div></div></div> }
    const noop=()=>{};
    const visits=[
      {id:'a',clientName:'Jan Kowalski',serviceName:'Strzyżenie + broda',dateKey:'2026-10-10',startTime:'15:30',price:'90 zł',priceAmount:90},
      {id:'b',clientName:'Marek Nowak',serviceName:'Strzyżenie',dateKey:'2026-10-10',startTime:'16:30',price:'60 zł',priceAmount:60},
      {id:'c',clientName:'Piotr Zieliński',serviceName:'Broda',dateKey:'2026-10-09',startTime:'18:00',price:'40 zł',priceAmount:40},
    ];
    function Unsettled(){ const [list,setList]=React.useState(visits); return <UnsettledDialog visits={list} settlingId={null} busy={false} onSettle={(v)=>setList(l=>l.filter(x=>x.id!==v.id))} onNoShow={(v)=>setList(l=>l.filter(x=>x.id!==v.id))} onSettleAll={()=>setList([])} onClose={()=>{document.body.dataset.closed='1'}}/> }
    const page=location.pathname;
    createRoot(document.getElementById('root')).render(
      page==='/prompt'?<div className="client-appointment-modal" style={{maxWidth:420,margin:'40px auto',padding:20,overflow:'visible'}}><ReviewPrompt appointmentId="a1" barberName="Mateusz"/></div>
      :page==='/unsettled'?<Unsettled/>
      :page==='/wizard'?<Wizard/>
      :page==='/days'?<Days/>
      :page==='/success'?<SuccessScreen ready summary={{barberId:'mateusz',barberName:'Mateusz Kowalski',barberPhotoUrl:'',serviceName:'Strzyżenie + broda',servicePrice:'90 zł',durationMinutes:60,date:new Date(2026,9,12),time:'15:30',fullName:'Jan Kowalski',phone:'600 100 200'}}/>
      :<Home busy={false} signedIn={false} admin={false} error="" onBook={noop} onPanel={noop} onVisits={noop}/>);
  ` },
  write: false, bundle: true, jsx: "automatic", format: "esm", platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "isolated-data", setup(builder) {
    builder.onResolve({ filter: /^firebase\/database$/ }, () => ({ path: "database", namespace: "fake" }));
    builder.onResolve({ filter: /^firebase\/auth$/ }, () => ({ path: "auth", namespace: "fake" }));
    builder.onResolve({ filter: /(lib\/|\.\/)firebase$/ }, () => ({ path: "app", namespace: "fake" }));
    builder.onLoad({ filter: /.*/, namespace: "fake" }, args => ({
      contents: args.path === "database" ? firebaseMock
        : args.path === "auth" ? "export const getAuth=()=>({currentUser:{getIdToken:async()=>'test'}});"
        : "export const realtimeDb = {}; export const firebaseApp = {}; export const storageBucket = \"\";",
      loader: "js",
    }));
  } }],
});
const assets = path.join(root, "dist/client/assets");
const css = fs.readdirSync(assets).filter(file => file.endsWith(".css")).map(file => fs.readFileSync(path.join(assets, file), "utf8")).join("\n");
const now = Date.now();
const review = (id, barberId, rating, text, authorName, serviceName, ago) => ({ id, barberId, rating, text, authorName, serviceName, createdAt: now - ago * 86_400_000 });
const reviews = [
  review("1", "mateusz", 5, "Najlepszy fade w mieście. Dokładność co do milimetra, świetna atmosfera.", "Jan K.", "Strzyżenie + broda", 1),
  review("2", "kacper", 5, "Pełen profesjonalizm, polecam!", "Marek N.", "Strzyżenie", 3),
  review("3", "mateusz", 4, "Bardzo dobrze, tylko mały poślizg z terminem.", "Piotr Z.", "Broda", 6),
  review("4", "kacper", 5, "", "Tomek W.", "Strzyżenie", 9),
  review("5", "mateusz", 5, "Wracam co trzy tygodnie i za każdym razem to samo: super.", "Adam S.", "Strzyżenie", 14),
];
const summary = { count: 23, average: 4.8, distribution: [0, 1, 1, 4, 17], byBarber: {
  mateusz: { count: 14, average: 4.9, distribution: [0, 0, 1, 2, 11] },
  kacper: { count: 9, average: 4.6, distribution: [0, 1, 0, 2, 6] },
} };
http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const json = (body) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(body)); };
  if (url.pathname === "/.netlify/functions/public-barbers") {
    return json({ barbers: [
      { id: "mateusz", displayName: "Mateusz Kowalski", photoUrl: "", bio: "", specialties: "", instagram: "" },
      { id: "kacper", displayName: "Kacper Nowak", photoUrl: "", bio: "", specialties: "", instagram: "" },
    ] });
  }
  if (url.pathname === "/.netlify/functions/reviews") {
    if (request.method === "POST") return json({ ok: true, review: review("new", "mateusz", 5, "Super!", "Jan K.", "Strzyżenie", 0) });
    if (url.searchParams.has("appointmentId")) return json({ ok: true, review: null });
    return json({ ok: true, reviews, summary });
  }
  if (url.pathname === "/qa.js") { response.setHeader("Content-Type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html lang="pl"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>BNB, podgląd opinii</title><style>${css}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>`);
}).listen(4189, "127.0.0.1", () => console.log("Reviews QA: http://127.0.0.1:4189/"));
