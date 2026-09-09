import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium}=createRequire(import.meta.url)("playwright");
const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
try {
  for(const width of [320,390,768,1440]){
    const page=await browser.newPage({viewport:{width,height:844}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto("http://127.0.0.1:4188/");
    assert.match(await page.locator(".salon-brand img").getAttribute("src"),/bnb-mark\.png$/);
    const logoRatio=await page.locator(".salon-brand").evaluate(element=>{const box=element.getBoundingClientRect();return box.width/box.height});
    assert.ok(Math.abs(logoRatio-(16/9))<0.02);
    const notification=page.locator(".salon-notification");
    await notification.waitFor();
    assert.equal(await notification.evaluate(element=>element.classList.contains("disabled")),true);
    const disabledColor=await notification.evaluate(element=>getComputedStyle(element).backgroundColor);
    await notification.click();
    assert.equal(await notification.evaluate(element=>element.classList.contains("enabled")),true);
    const enabledColor=await notification.evaluate(element=>getComputedStyle(element).backgroundColor);
    assert.notEqual(enabledColor,disabledColor);
    assert.equal(await page.getByText("Z bliska",{exact:true}).count(),0);
    const galleryBottom=await page.locator(".salon-gallery").evaluate(element=>element.getBoundingClientRect().bottom);
    const titleTop=await page.getByRole("heading",{name:/Dobre cięcie/}).evaluate(element=>element.getBoundingClientRect().top);
    assert.ok(galleryBottom<=titleTop,"gallery must stay above the landing copy");
    if(width<=700){
      const boxes=await page.evaluate(()=>({session:document.querySelector('.salon-session').getBoundingClientRect(),nav:document.querySelector('.salon-header nav').getBoundingClientRect()}));
      assert.ok(boxes.nav.top>=boxes.session.bottom,"mobile navigation belongs below the account row");
    }
    await page.locator(".salon-person").first().click();
    assert.equal(await page.getByRole("link",{name:/Instagram/}).getAttribute("href"),"https://www.instagram.com/mateusz/");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".salon-person").first().evaluate(el=>el===document.activeElement),true);
    await page.locator(".salon-person").last().click();
    assert.equal(await page.getByRole("dialog").getByRole("link",{name:/Instagram/}).count(),0);
    await page.getByRole("button",{name:"Zamknij okno"}).click();
    await page.screenshot({path:`outputs/gallery-layout-${width}.png`,fullPage:true});
    await page.locator(".salon-gallery button").first().click();
    await page.locator(".salon-lightbox").waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:`outputs/gallery-${width}.png`,fullPage:true});
    await page.keyboard.press("Escape");
    await page.getByRole("button",{name:"Pokaż wszystkie zdjęcia"}).click();
    await page.locator(".salon-gallery-dialog").waitFor();
    assert.equal(await page.locator(".salon-gallery-all button").count(),2);
    await page.locator(".salon-gallery-all button").first().click();
    await page.locator(".salon-lightbox").waitFor();
    await page.keyboard.press("Escape");
    await page.goto("http://127.0.0.1:4188/manager");
    await page.locator(".salon-manager-grid article").first().waitFor();
    const first=await page.locator(".salon-manager-grid img").first().getAttribute("src");
    await page.getByRole("button",{name:"Przesuń zdjęcie dalej"}).first().click();
    assert.notEqual(await page.locator(".salon-manager-grid img").first().getAttribute("src"),first);
    await page.locator('input[type="file"]').setInputFiles("public/brand/bnb-logo.png");
    await page.getByText("Dodaj zdjęcie (3/6)").waitFor();
    page.on("dialog",dialog=>dialog.accept());
    await page.getByRole("button",{name:"Usuń zdjęcie"}).last().click();
    await page.getByText("Dodaj zdjęcie (2/6)").waitFor();
    await page.getByLabel("Adres",{exact:true}).fill("Testowa 1");
    await page.getByLabel("Godziny otwarcia").fill("Poniedziałek 10–18");
    await page.getByRole("button",{name:"Zapisz informacje"}).click();
    await page.getByText("Zmiany zapisane.").waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    console.log(`PASS salon ${width}px: profiles, legacy profile, Instagram, focus, lightbox, gallery upload/order/delete, settings, overflow`);
    await page.close();
  }
}finally{await browser.close();}
