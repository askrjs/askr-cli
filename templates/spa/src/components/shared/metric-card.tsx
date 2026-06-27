import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@askrjs/themes/components';
import { Inline } from '@askrjs/themes/components';

export type MetricCardProps = {
  label: string;
  value: string;
  trend: string;
};

export default function MetricCard({ label, value, trend }: MetricCardProps) {
  return (
    <Card class="metric-card">
      <CardHeader>
        <Inline justify="between" align="center" gap="3">
          <CardDescription>{label}</CardDescription>
          <span class="metric-trend">{trend}</span>
        </Inline>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
