import type { Metadata } from "next";
import { BookingHome } from "./booking-home";

export const metadata: Metadata = {
  title: "BNB Barbershop | Rezerwacja wizyty",
  description: "Ciemny kalendarz rezerwacji usług barberskich BNB Barbershop.",
};

export default function Home() {
  return <BookingHome />;
}
