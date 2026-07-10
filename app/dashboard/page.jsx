import HomeDashboard from "./HomeDashboard";
import HomeLegacy from "./HomeLegacy";

export default async function DashboardPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  return resolvedSearchParams?.legacy === "1" ? <HomeLegacy /> : <HomeDashboard />;
}
