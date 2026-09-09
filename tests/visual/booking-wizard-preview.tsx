import { useState } from "react";
import BookingWizard from "../../app/components/booking-wizard";
import type { DayCell } from "../../app/lib/booking-types";

// Real wizard, deterministic in-memory data. No Firebase or production writes.
export default function WizardPreview() {
  const [open, setOpen] = useState(false);
  const [barberId, setBarber] = useState<string | null>(null);
  const [serviceId, setService] = useState("");
  const [dateKey, setDay] = useState("2026-09-08");
  const [time, setTime] = useState("");
  const [form, setForm] = useState({ fullName: "", phone: "" });
  const [month, setMonth] = useState(new Date(2026, 8, 1));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const days: DayCell[] = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(month.getFullYear(), month.getMonth(), 1 - (month.getDay()+6)%7 + index);
    const freeSlots = [8,9,10].includes(date.getDate()) ? 3 : 0;
    return { date, day: date.getDate(), monthOffset: date.getMonth() === month.getMonth() ? 0 : date < month ? -1 : 1, availability: freeSlots ? "high" : "none", freeSlots, totalSlots: 3 };
  });
  return <main className="app-shell">
    {!open ? <><h1>{success ? "Wizyta potwierdzona" : "Salon — podgląd testowy"}</h1><button onClick={() => {setSuccess(false);setOpen(true)}}>Umów wizytę</button><output aria-label="Liczba zapisów">{attempts}</output></> : <BookingWizard
      barbers={[{id:"one", name:"Mateusz Kowalski",label:"Barber",bio:"Klasyczne strzyżenia i precyzyjne modelowanie brody."},{id:"two",name:"Kacper",label:"Barber"}]}
      barberId={barberId} services={[{id:"hair",barberId:barberId || "one",name:"Strzyżenie włosów",price:"60 zł",durationMinutes:30},{id:"combo",barberId:barberId || "one",name:"Włosy i broda",price:"100 zł",durationMinutes:60}]}
      serviceId={serviceId} days={days} dateKey={dateKey} month={month} times={["10:00","11:00","12:00"]} time={time} form={form}
      catalogReady calendarReady canPreviousMonth={month.getMonth()>8} canConfirm={form.fullName.length>=3 && form.phone.replace(/\D/g,"").length===9}
      busy={busy} refreshing={false} error={error} nearest={{date:new Date(2026,8,8),time:"10:00"}}
      onBarber={id=>{if(id!==barberId){setBarber(id);setService("");setTime("")}}} onService={id=>{if(id!==serviceId){setService(id);setTime("")}}}
      onDay={key=>{if(key!==dateKey){setDay(key);setTime("")}}} onTime={setTime}
      onMonth={direction=>setMonth(new Date(month.getFullYear(),month.getMonth()+direction,1))}
      onForm={(field,value)=>setForm(current=>({...current,[field]:field==="phone"?value.replace(/\D/g,"").slice(0,9):value}))}
      onClose={()=>setOpen(false)} onRetry={async()=>setError("")}
      onNearest={()=>{setDay("2026-09-08");setTime("10:00")}} onWaitlist={()=>setError("Test listy rezerwowej: zachowane wywołanie istniejącego formularza.")}
      onConfirm={async()=>{setAttempts(value=>value+1);setBusy(true);await new Promise(resolve=>setTimeout(resolve,350));setBusy(false);if(!attempts){setError("Test: chwilowy błąd zapisu. Spróbuj ponownie.");return;}setOpen(false);setSuccess(true)}}
    />}
  </main>;
}
