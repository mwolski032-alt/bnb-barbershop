// Read-only production smoke test. Never logs in or submits an appointment.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium}=createRequire(import.meta.url)("playwright");
const base="https://bnbbarber.netlify.app";
const html=await fetch(base).then(r=>r.text());
assert.match(html,/<meta name="theme-color" content="#F6EBD7"\s*\/>/);
assert.doesNotMatch(html,/<meta name="theme-color"[^>]*media=/);
const sw=await fetch(base+"/sw.js");
assert.match(await sw.text(),/bnb-barbershop-v22/);
assert.match(sw.headers.get("cache-control"),/max-age=0/);
const manifest=await fetch(base+"/manifest.webmanifest?v=10").then(r=>r.json());
assert.equal(manifest.theme_color,"#F6EBD7");
const privateResponse=await fetch(base+"/.netlify/functions/appointments");
assert.equal(privateResponse.status,401,"anonymous calendar access denied");
const team=await fetch(base+"/.netlify/functions/public-barbers").then(r=>r.json());
assert.ok(Array.isArray(team.barbers));
for(const member of team.barbers)assert.deepEqual(Object.keys(member).sort(),["id","displayName","photoUrl","bio","specialties","instagram"].sort());
const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
try{
  for(const width of [360,390,768,1440]){
    const context=await browser.newContext({viewport:{width,height:844}});
    const page=await context.newPage();const errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    page.on("console",m=>{if(["error","warning"].includes(m.type()))errors.push(m.text())});
    await page.goto(base,{waitUntil:"load"});
    await page.locator(".salon-cta:not(:disabled)").first().waitFor();
    const metrics=await page.evaluate(()=>({readyMs:Math.round(performance.now()),fcpMs:Math.round(performance.getEntriesByName("first-contentful-paint")[0]?.startTime||0)}));
    await page.locator(".salon-person").first().click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button",{name:"Zamknij okno"}).click();
    await page.getByRole("button",{name:"Umów wizytę",exact:true}).click();
    await page.getByRole("heading",{name:"Twój następny termin"}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.getByRole("button",{name:"‹ Strona salonu"}).click();
    await page.screenshot({path:`outputs/production-${width}.png`,fullPage:true});
    await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({width,...metrics,publicBarbers:team.barbers.length,console:"clean",flow:"home/profile/login/home",serviceWorker:"ready"}));
    await context.close();
  }
}finally{await browser.close();}
