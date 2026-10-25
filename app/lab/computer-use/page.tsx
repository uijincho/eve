import type { Metadata } from "next";

import { ComputerUseLab } from "@/components/lab/computer-use-lab";

export const metadata: Metadata = {
  title: "Computer use lab · Eve",
  description: "Watch Eve fill a fictional university finance portal on a live desktop, one step at a time.",
};

export default function ComputerUseLabPage() {
  return <ComputerUseLab />;
}
