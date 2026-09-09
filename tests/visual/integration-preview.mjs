// The actual BookingHome and actual appointments handler, with Firebase/auth
// boundaries replaced by the existing in-memory test fixture. Localhost only.
import { build } from "esbuild";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installAppointmentsFixture, tokens, clientAUid, mateuszUid, ownerUid } from "../helpers/appointments-fixture.mjs";
const fixture = installAppointmentsFixture();
const { default: appointments } = await import("../../netlify/functions/appointments.mjs");
const { default: publicBarbers } = await import("../../netlify/functions/public-barbers.mjs");
const { default: appointmentHistory } = await import("../../netlify/functions/appointment-history.mjs");
const { default: dataBackup } = await import("../../netlify/functions/data-backup.mjs");
const root = fileURLToPath(new URL("../../", import.meta.url));
let failNextAppointment = false;
function reset() {
  fixture.reset();
  failNextAppointment = false;
  const date = new Date(); date.setDate(date.getDate()+1);
  const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  for (const id of ["mateusz", "kacper"]) {
    fixture.database.team.barbers[id].name = id === "mateusz" ? "Mateusz" : "Kacper";
    fixture.database.barbers[id].workSettings.availability[key] = {id:key,barberId:id,dateKey:key,startTime:"08:00",endTime:"18:00"};
  }
  fixture.database.appointments["mateusz-upcoming"].status = "rescheduled";
  fixture.database.appointments["mateusz-upcoming"].rescheduledBy = "admin";
  fixture.database.barbers.mateusz.profile = {displayName:"Mateusz",bio:"Klasyczne strzyżenia",instagram:"mateusz",specialties:"Broda, Fade"};
}
reset();
const authMock = `
const role = new URLSearchParams(location.search).get('role') || 'client';
const identities = ${JSON.stringify({client:{uid:clientAUid,token:tokens.clientA},barber:{uid:mateuszUid,token:tokens.mateusz},owner:{uid:ownerUid,token:tokens.owner}})};
const entry=identities[role] || identities.client;
const user={uid:entry.uid,displayName:'Jan Testowy',email:'qa@example.com',emailVerified:true,photoURL:null,getIdToken:async()=>entry.token};
const auth={currentUser:sessionStorage.getItem('qa-auth')==='1'?user:null}; const listeners=new Set();
export const getAuth=()=>auth;
export const onAuthStateChanged=(_,cb)=>{listeners.add(cb);queueMicrotask(()=>cb(auth.currentUser));return ()=>listeners.delete(cb)};
export const signInWithPopup=async()=>{sessionStorage.setItem('qa-auth','1');auth.currentUser=user;listeners.forEach(cb=>cb(user));return {user}};
export const signInWithRedirect=signInWithPopup;
export const getRedirectResult=async()=>null;
export const signOut=async()=>{sessionStorage.removeItem('qa-auth');auth.currentUser=null;listeners.forEach(cb=>cb(null))};
export class GoogleAuthProvider {setCustomParameters(){}}
`;
const databaseMock = `
export const ref=(_,path='')=>path;
export const onValue=(path,cb,error)=>{let active=true;fetch('/qa-database?path='+encodeURIComponent(path)).then(r=>r.json()).then(value=>{if(active)cb({val:()=>value})}).catch(e=>{if(active)error?.(e)});return ()=>{active=false}};
export const get=async path=>{const value=await fetch('/qa-database?path='+encodeURIComponent(path)).then(r=>r.json());return {val:()=>value,exists:()=>value!=null}};
export const set=async()=>{throw Error('Direct writes are tested separately in the emulator')};
export const update=set;export const runTransaction=set;export const serverTimestamp=()=>Date.now();
`;
const bundle = await build({stdin:{resolveDir:root,loader:"tsx",contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {BookingHome} from './app/booking-home';createRoot(document.getElementById('root')).render(<BookingHome/>);`},write:false,bundle:true,jsx:"automatic",format:"esm",platform:"browser",define:{"process.env.NODE_ENV":'"development"'},plugins:[{name:"isolated-boundaries",setup(b){
  b.onResolve({filter:/^firebase\/auth$/},()=>({path:"auth",namespace:"fake"}));
  b.onResolve({filter:/^firebase\/database$/},()=>({path:"database",namespace:"fake"}));
  b.onResolve({filter:/^firebase\/messaging$/},()=>({path:"messaging",namespace:"fake"}));
  b.onResolve({filter:/lib\/firebase$|^\.\/firebase$/},()=>({path:"app",namespace:"fake"}));
  b.onLoad({filter:/.*/,namespace:"fake"},a=>({loader:"js",contents:a.path==="auth"?authMock:a.path==="database"?databaseMock:a.path==="messaging"?"export const isSupported=async()=>false;export const getMessaging=()=>({});export const getToken=async()=>'';export const deleteToken=async()=>true;export const onMessage=()=>()=>{};":"export const firebaseApp={};export const realtimeDb={};"}));
}}]});
const css=fs.readdirSync(path.join(root,"dist/client/assets")).filter(f=>f.endsWith(".css")).map(f=>fs.readFileSync(path.join(root,"dist/client/assets",f),"utf8")).join("\n");
http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,"http://127.0.0.1:4191");
    if(url.pathname==="/qa-reset"){reset();res.end("ok");return;}
    if(url.pathname==="/qa-fail-next"){failNextAppointment=true;res.end("ok");return;}
    if(url.pathname==="/qa-database"){
      const value=(url.searchParams.get("path") || "").split("/").filter(Boolean).reduce((v,k)=>v?.[k],fixture.database);
      res.setHeader("Content-Type","application/json");res.end(JSON.stringify(value??null));return;
    }
    if(url.pathname.startsWith("/.netlify/functions/") || url.pathname.startsWith("/api/")){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const requestBody=Buffer.concat(chunks).toString();
      const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==="POST"?{body:requestBody}: {})});
      if(url.pathname.endsWith("/appointments") && String(req.headers.referer || "").includes("slow=1")) await new Promise(resolve=>setTimeout(resolve,900));
      const response=url.pathname.endsWith("/appointments") && failNextAppointment && requestBody.includes('"action":"cancel_client"')
        ? (failNextAppointment=false, Response.json({message:"Symulowany błąd zapisu."},{status:503}))
        : url.pathname.endsWith("/appointments")?await appointments(request)
          :url.pathname.endsWith("/public-barbers")?await publicBarbers(request)
          :url.pathname.endsWith("/appointment-history")?await appointmentHistory(request)
          :url.pathname.endsWith("/data-backup")?await dataBackup(request)
          :Response.json({ok:true});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
    }
    if(url.pathname==="/qa.js"){res.setHeader("Content-Type","text/javascript");res.end(bundle.outputFiles[0].text);return;}
    if(url.pathname.startsWith("/brand/") || url.pathname.startsWith("/icons/")){
      const file=path.join(root,"public",url.pathname);if(fs.existsSync(file)){res.end(fs.readFileSync(file));return;}
    }
    res.setHeader("Content-Type","text/html; charset=utf-8");res.end(`<!doctype html><html lang="pl"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>`);
  }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}
}).listen(4191,"127.0.0.1",()=>console.log("Isolated app + real API: http://127.0.0.1:4191/"));
