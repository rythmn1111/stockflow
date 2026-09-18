import { useState } from 'react'
import { ArrowRightIcon, BoxesIcon, FactoryIcon, ScrollTextIcon, ShoppingCartIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { qk } from '@/lib/query-keys'
import { useAppMutation } from '@/hooks/use-data'

/**
 * One screen, two fields. The point is not to collect settings — it is to explain the
 * four things this app does and the order they happen in, because the workbook's six
 * sheets gave no hint about which came first.
 */
export function OnboardingFlow(): React.JSX.Element {
  const [companyName, setCompanyName] = useState('')
  const [defaultUnit, setDefaultUnit] = useState('Nos.')

  const complete = useAppMutation(
    (payload: { companyName?: string; defaultUnit?: string }) => window.api.settings.completeOnboarding(payload),
    { invalidate: [qk.settings] }
  )

  const steps = [
    { icon: BoxesIcon, title: 'Items', body: 'Your raw materials and finished goods, with reorder levels, weights, packing and shelf locations.' },
    { icon: FactoryIcon, title: 'Bill of materials', body: 'What each finished good is made from. Sub-assemblies are followed automatically.' },
    { icon: ShoppingCartIcon, title: 'Orders', body: 'Plan an order and StockFlow works out what to issue and what to buy — without double-promising stock to two orders.' },
    { icon: ScrollTextIcon, title: 'Material log', body: 'Every receipt and issue. Stock is calculated from this, never typed in.' }
  ]

  return (
    <div className="flex h-screen items-center justify-center overflow-y-auto bg-background p-6">
      <div className="w-full max-w-lg space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold">StockFlow</h1>
          <p className="text-sm text-muted-foreground">
            A stock register and material planner that keeps its arithmetic honest.
          </p>
        </div>

        <div className="space-y-3">
          {steps.map((step, index) => (
            <div key={step.title} className="flex gap-3 rounded-lg border p-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                <step.icon className="size-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {index + 1}. {step.title}
                </p>
                <p className="text-xs text-muted-foreground">{step.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-1.5">
            <Label htmlFor="onboardCompany">Company name</Label>
            <Input
              id="onboardCompany"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Optional — appears on printed reports"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="onboardUnit">Default unit</Label>
            <Input
              id="onboardUnit"
              value={defaultUnit}
              onChange={(e) => setDefaultUnit(e.target.value)}
              placeholder="Nos."
            />
          </div>
        </div>

        <Button
          className="w-full gap-1.5"
          disabled={complete.isPending}
          onClick={() =>
            complete.mutate({
              companyName: companyName.trim() || undefined,
              defaultUnit: defaultUnit.trim() || 'Nos.'
            })
          }
        >
          Get started
          <ArrowRightIcon className="size-4" />
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Everything stays in a file on this computer. No account, no cloud.
        </p>
      </div>
    </div>
  )
}
