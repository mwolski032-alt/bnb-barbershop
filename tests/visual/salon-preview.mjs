// Isolated interactive QA of the real components. All database operations stay
// in memory; this server never connects to production or authenticates a user.
import { build } from "esbuild";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const firebaseMock = `
let store={gallery:{0:{id:'one',imageUrl:'/brand/bnb-hero-960.webp',alt:'Wnętrze salonu',order:0},1:{id:'two',imageUrl:'/brand/bnb-hero-1440.jpg',alt:'Detal salonu',order:1}},settings:{address:'',openingHours:''}};
const listeners=new Set();
export const ref=(_,path)=>path;
export function onValue(_,cb){listeners.add(cb);cb({val:()=>store});return ()=>listeners.delete(cb)}
const notify=()=>listeners.forEach(cb=>cb({val:()=>store}));
export async function runTransaction(_,change){const next=change(store.gallery);if(next===undefined)return {committed:false};store.gallery=next;notify();return {committed:true}}
export async function set(_,value){store.settings=value;notify()}
`;
const bundle = await build({
  stdin: { resolveDir: root, loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Home from './app/components/salon-home'; import Manager from './app/components/salon-manager';
    import Settings from './app/components/screens/admin-settings-screen';
    import Wizard from './tests/visual/booking-wizard-preview';
    const noop=()=>{};
    function Profile(){ const [draft,setDraft]=React.useState({displayName:'Mateusz Kowalski',phone:'',email:'',instagram:'https://instagram.com/mateusz/',bio:'Klasyczne strzyżenia i pielęgnacja brody.',photoUrl:'',specialties:'Fade, Broda'});return <div className="app-shell admin-page"><Settings mode="profile" barberName="Mateusz" barber={{accent:'mint',label:'Barber',name:'Mateusz'}} draft={draft} feedback={null} isSaving={false} isPhotoProcessing={false} isSaveActionPending={false} onPhotoChange={noop} onChange={(field,value)=>setDraft({...draft,[field]:value})} onSave={noop}/></div>}
    function Landing(){ const [enabled,setEnabled]=React.useState(false);return <Home busy={false} signedIn={true} admin={true} error="" onBook={()=>document.body.dataset.book='clicked'} onPanel={()=>location.href='/manager'} onVisits={noop} onInstall={noop} account={{name:'Jan Testowy'}} notification={{label:enabled?'Powiadomienia włączone':'Powiadomienia wyłączone',enabled,status:enabled?'enabled':'disabled',busy:false}} onNotifications={()=>setEnabled(value=>!value)} onSignOut={noop}/> }
    const page=location.pathname;
    createRoot(document.getElementById('root')).render(page==='/wizard'?<React.StrictMode><Wizard/></React.StrictMode>:page==='/manager'?<div style={{maxWidth:700,margin:'auto'}}><Manager/></div>:page==='/profile'?<Profile/>:<Landing/>);
  ` },
  write: false, bundle: true, jsx: "automatic", format: "esm", platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "isolated-data", setup(builder) {
    builder.onResolve({ filter: /^firebase\/database$/ }, () => ({ path: "database", namespace: "fake" }));
    builder.onResolve({ filter: /lib\/firebase$/ }, () => ({ path: "app", namespace: "fake" }));
    builder.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ contents: args.path === "database" ? firebaseMock : "export const realtimeDb = {};", loader: "js" }));
  } }],
});
const assets = path.join(root, "dist/client/assets");
const css = fs.readdirSync(assets).filter(file => file.endsWith(".css")).map(file => fs.readFileSync(path.join(assets,file),"utf8")).join("\n");
http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/.netlify/functions/public-barbers") {
    response.setHeader("Content-Type", "application/json");
    return response.end(JSON.stringify({barbers:[{id:'mateusz',displayName:'Mateusz Kowalski',photoUrl:'/brand/bnb-hero-960.webp',bio:'Klasyczne strzyżenia. Dbałość o każdy detal.',specialties:'Fade, Broda',instagram:'https://www.instagram.com/mateusz/'},{id:'legacy',displayName:'Kacper',photoUrl:'',bio:'',specialties:'',instagram:''}]}));
  }
  if (pathname.startsWith("/brand/")) {
    const file = path.join(root,"public/brand",path.basename(pathname));
    if (fs.existsSync(file)) {response.setHeader("Content-Type",pathname.endsWith(".avif")?"image/avif":pathname.endsWith(".webp")?"image/webp":pathname.endsWith(".png")?"image/png":"image/jpeg");return response.end(fs.readFileSync(file));}
  }
  if (pathname === "/qa.js") {response.setHeader("Content-Type","text/javascript");return response.end(bundle.outputFiles[0].text);}
  response.setHeader("Content-Type","text/html; charset=utf-8");
  response.end(`<!doctype html><html lang="pl"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>BNB — izolowany podgląd QA</title><style>${css}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>`);
}).listen(4188,"127.0.0.1",()=>console.log("QA fixtures: http://127.0.0.1:4188/"));
