import type { Metadata } from "next";

import { PeopleView } from "@/components/app/views/people-view";

export const metadata: Metadata = { title: "People · Eve" };

export default function Page() {
  return <PeopleView />;
}
