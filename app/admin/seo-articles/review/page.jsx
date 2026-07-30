import OperationsAreaClient from "../OperationsAreaClient";

export const metadata = { title: "SEO review queue | ClearTill admin" };

export default function SeoReviewQueuePage() {
  return <OperationsAreaClient area="review" />;
}
