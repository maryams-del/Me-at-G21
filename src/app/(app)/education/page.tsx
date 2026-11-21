import { SpaceHub } from "@/components/SpaceHub";

export default async function EducationIndex({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const items = [
    { href: "/education/applications", label: "Master's applications", glyph: "applications" as const },
    { href: "/projects", label: "Projects & tasks", glyph: "projects" as const },
    { href: "/education/achievements", label: "Achievements & hobbies", glyph: "achievements" as const },
  ];
  return <SpaceHub title="Education & career" glyph="applications" items={items} fromHome={from === "home"} />;
}
