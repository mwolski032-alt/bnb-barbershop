import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
const {chromium}=createRequire(import.meta.url)("playwright");
const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
fs.mkdirSync("outputs",{recursive:true});
try {
  for(const width of [360,1440]) {
    await fetch("http://127.0.0.1:4191/qa-reset");
    const page=await browser.newPage({viewport:{width,height:850}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.route("**/*",route=>new URL(route.request().url()).hostname==="127.0.0.1"?route.continue():route.abort());
    await page.goto("http://127.0.0.1:4191/?slow=1");
    await page.getByRole("button",{name:"Umów wizytę",exact:true}).click();
    await page.getByRole("button",{name:/Kontynuuj z Google/}).click();
    await page.locator(".story-barber").filter({hasText:"Mateusz"}).click();
    await page.locator(".story-service").first().click();
    await page.getByRole("button",{name:/Dołącz do listy rezerwowej/}).click();
    await page.locator(".waitlist-modal").waitFor();
    await page.evaluate(()=>history.back());
    await page.locator(".waitlist-modal").waitFor({state:"hidden"});
    assert.equal(await page.locator(".story-progress li:nth-child(3)").getAttribute("aria-current"),"step");
    await page.locator(".story-days button:not([disabled])").first().click();
    await page.locator(".story-times button").first().click();
    await page.getByLabel("Numer telefonu").fill("500600700");
    await page.getByRole("button",{name:/Przejdź do podsumowania/}).click();
    const responsePromise=page.waitForResponse(r=>r.url().includes("/appointments")&&r.request().method()==="POST");
    await page.getByRole("button",{name:"Potwierdzam rezerwację"}).click();
    await page.locator(".salon-home").waitFor({timeout:400});
    await page.locator(".salon-feedback.pending").waitFor({timeout:400});
    const response=await responsePromise;
    assert.equal(response.status(),200,await response.text());
    await page.locator(".salon-home").waitFor();
    assert.equal(await page.locator(".bottom-footer").count(),0,"the remembered booking must not expose the retired footer on the salon page");
    assert.equal(await page.locator(".success-card, .success-panel, .success-animation, .success-check").count(),0);
    assert.match(await page.locator("body").innerText(),/zarezerwowana|zapisana/i);
    await page.locator(".salon-visits-badge").waitFor();
    assert.ok(Number.parseInt(await page.locator(".salon-visits-badge").innerText(),10)>=1,"a barber-proposed change must appear in the visits badge");
    await page.screenshot({path:`outputs/integration-success-${width}.png`,fullPage:true});
    const data=await fetch("http://127.0.0.1:4191/qa-database?path=appointments").then(r=>r.json());
    assert.equal(Object.keys(data).length,4,"one new real-handler appointment only");
    await page.getByRole("button",{name:"Wyloguj",exact:true}).waitFor();
    const notificationButton=page.getByRole("button",{name:/Powiadomienia/});
    await notificationButton.click();
    const notificationFeedback=page.locator(".salon-feedback.error");
    await notificationFeedback.waitFor();
    assert.match(await notificationFeedback.innerText(),/powiadomie|przeglądarka/i);
    await page.getByRole("button",{name:"Moje wizyty",exact:true}).click();
    await page.locator(".client-appointment-option").first().click();
    await page.getByRole("dialog").getByRole("button",{name:"Zmień",exact:true}).click();
    await page.locator(".story-days button:not([disabled])").first().click();
    await page.locator(".story-times button").last().click();
    await page.getByRole("button",{name:/Przejdź do podsumowania/}).click();
    const moved=page.waitForResponse(r=>r.url().includes("/appointments")&&r.request().method()==="POST");
    await page.getByRole("button",{name:"Potwierdź zmianę terminu"}).click();
    await page.locator(".salon-home").waitFor({timeout:400});
    await page.locator(".salon-feedback.pending").waitFor({timeout:400});
    assert.equal((await moved).status(),200);
    await page.locator(".salon-home").waitFor();
    await page.getByRole("button",{name:"Moje wizyty",exact:true}).click();
    await page.locator(".client-appointment-option").first().click();
    await page.getByRole("button",{name:"Odwołaj wizytę",exact:true}).click();
    await fetch("http://127.0.0.1:4191/qa-fail-next");
    const rejectedCancellation=page.waitForResponse(r=>r.url().includes("/appointments")&&r.request().method()==="POST"&&r.request().postData()?.includes('"action":"cancel_client"'));
    await page.getByRole("alertdialog").getByRole("button",{name:"Odwołaj wizytę",exact:true}).click();
    await page.locator(".salon-home").waitFor({timeout:400});
    await page.locator(".salon-feedback.pending").waitFor({timeout:400});
    assert.equal((await rejectedCancellation).status(),503);
    await page.locator(".salon-feedback.error").waitFor();
    await page.getByRole("button",{name:"Moje wizyty",exact:true}).click();
    await page.locator(".client-appointment-option").first().waitFor();
    await page.locator(".client-appointment-option").first().click();
    await page.getByRole("button",{name:"Odwołaj wizytę",exact:true}).click();
    const cancelled=page.waitForResponse(r=>r.url().includes("/appointments")&&r.request().method()==="POST"&&r.request().postData()?.includes('"action":"cancel_client"'));
    await page.getByRole("alertdialog").getByRole("button",{name:"Odwołaj wizytę",exact:true}).click();
    await page.locator(".salon-home").waitFor({timeout:400});
    await page.locator(".salon-feedback.pending").waitFor({timeout:400});
    assert.equal((await cancelled).status(),200);
    await page.locator(".salon-home").waitFor();
    await page.getByRole("button",{name:"Wyloguj",exact:true}).click();
    await page.getByRole("button",{name:/Zaloguj się/}).waitFor();
    assert.deepEqual(errors,[]);
    console.log(`PASS full app + real API ${width}px: landing, auth boundary, barber, catalog, calendar, time, details, confirmed booking`);
    await page.close();
  }
  for(const role of ["barber","owner"]) {
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    if(role==="owner") await page.route("**/api/client-errors",async route=>{
      if(route.request().method()==="GET") return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({reports:[{
        id:"1234567890abcdef1234567890abcdef",type:"network",message:"POST /appointments: HTTP 503",stack:"",
        route:"/",screen:"rezerwacja-krok-6",release:"qa-release",count:2,firstSeenAt:Date.now()-60000,
        lastSeenAt:Date.now(),resolvedAt:null,device:{browser:"Chrome 152",os:"Android 15",viewport:"390x844",installed:true,online:true,connection:"4g"}
      }]})});
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({report:{}})});
    });
    let salonCatalogRequests=0;
    page.on("request",request=>{if(request.url().includes("/.netlify/functions/public-barbers"))salonCatalogRequests+=1;});
    await page.goto(`http://127.0.0.1:4191/?role=${role}`);
    await page.getByRole("button",{name:"Umów wizytę",exact:true}).click();
    await page.getByRole("button",{name:/Kontynuuj z Google/}).click();
    await page.locator(".salon-person").first().waitFor({state:"attached"});
    if(role==="barber") {
      await page.locator(".story-barber").filter({hasText:"Mateusz"}).click();
      await page.locator(".story-service").first().click();
      assert.equal(await page.locator(".story-progress li:nth-child(3)").getAttribute("aria-current"),"step");
    }
    const catalogRequestsBeforeClose=salonCatalogRequests;
    await page.getByRole("button",{name:"Zamknij kreator"}).click();
    await page.waitForTimeout(250);
    assert.equal(salonCatalogRequests,catalogRequestsBeforeClose,"closing the wizard must not reload the salon catalog");
    if(role==="barber") {
      await page.getByRole("button",{name:"Umów wizytę",exact:true}).click();
      assert.equal(await page.locator(".story-progress li:nth-child(3)").getAttribute("aria-current"),"step","reopening must restore the unfinished booking step");
      await page.reload();
      await page.locator(".story-progress li:nth-child(3)").waitFor();
      assert.equal(await page.locator(".story-progress li:nth-child(3)").getAttribute("aria-current"),"step","a PWA refresh must restore the unfinished booking step");
      await page.getByRole("button",{name:"Zamknij kreator"}).click();
    }
    await page.getByRole("button",{name:/Twój panel/}).click();
    await page.locator(".admin-view").waitFor();
    if(role==="owner") {
      await page.getByRole("button",{name:"Zdjęcia",exact:true}).waitFor();
      assert.equal(await page.getByRole("region",{name:"Zarządzanie stroną salonu"}).count(),1);
      await page.getByRole("button",{name:"Barberzy",exact:true}).click();
      await page.locator('[aria-label="Wybór barbera"]').waitFor();
      assert.equal(await page.getByRole("region",{name:"Zarządzanie stroną salonu"}).count(),0);
      await page.getByRole("button",{name:"Błędy",exact:true}).click();
      await page.getByRole("region",{name:"Monitoring błędów"}).waitFor();
      assert.match(await page.locator(".error-monitor").innerText(),/Android 15.*Chrome 152/s);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:"outputs/integration-owner-monitoring.png",fullPage:true});
      await page.getByRole("button",{name:"Barberzy",exact:true}).click();
      await page.locator('[aria-label="Wybór barbera"]').waitFor();
    } else {
      assert.equal(await page.getByRole("region",{name:"Zarządzanie stroną salonu"}).count(),0);
      await page.getByRole("button",{name:"Praca",exact:true}).click();
      await page.getByRole("heading",{name:"Dni dostępne dla klientów"}).waitFor();
      assert.equal(await page.getByText("Gotowe okienka",{exact:true}).count(),0);
      const monthToggle=page.locator(".availability-month-toggle").first();
      await monthToggle.waitFor();
      assert.equal(await monthToggle.getAttribute("aria-expanded"),"false");
      await monthToggle.click();
      assert.equal(await monthToggle.getAttribute("aria-expanded"),"true");
    }
    await page.screenshot({path:`outputs/integration-${role}-panel.png`,fullPage:true});
    await page.getByRole("button",{name:"‹ Wróć"}).click();
    await page.locator(".salon-home").waitFor();
    assert.equal(await page.getByText("Twój panel",{exact:true}).count(),1);
    assert.equal(await page.getByRole("heading",{name:"Twój panel"}).count(),0);
    await page.getByRole("button",{name:/Twój panel/}).click();
    if(role==="owner") {
      await page.locator('[aria-label="Wybór barbera"]').waitFor();
    } else {
      await page.getByRole("heading",{name:"Dni dostępne dla klientów"}).waitFor();
      assert.equal(await page.locator(".availability-month-toggle").first().getAttribute("aria-expanded"),"true","panel must remember its section and expanded month");
    }
    await page.getByRole("button",{name:"‹ Wróć"}).click();
    await page.screenshot({path:`outputs/integration-${role}.png`,fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(`PASS ${role} app panel and gallery visibility`);
    await page.close();
  }
} finally {await browser.close();}
