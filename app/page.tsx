import type { Metadata } from "next";
import { BookingHome } from "./booking-home";

export const metadata: Metadata = {
  title: "BNB Barbershop | Rezerwacja wizyty",
  description: "B'n'B Barbershop — poznaj barberów, zobacz salon i umów wizytę.",
};

export default function Home() {
  return <BookingHome />;
}
