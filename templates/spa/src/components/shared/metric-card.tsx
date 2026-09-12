import { Block, Card, CardDescription, CardHeader, CardTitle } from '@askrjs/themes/components';

export type MetricCardProps = {
  label: string;
  value: string;
  trend: string;
};

export default function MetricCard({ label, value, trend }: MetricCardProps) {
  return (
    <Card class="metric-card">
      <CardHeader>
        <Block direction="row" justify="between" align="center" gap="md">
          <CardDescription>{label}</CardDescription>
          <span class="metric-trend">{trend}</span>
        </Block>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
