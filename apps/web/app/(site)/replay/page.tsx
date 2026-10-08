import replay from "../../../data/mainnet-replay.json";
import { formatAusd } from "../../../lib/account";
import { MAINNET_ID, addressUrl, txUrl } from "../../../lib/explorer";
import { formatPct } from "../../../lib/format";
import { Card } from "../../ui/card";
import { TourStop } from "../../ui/tour-state";
import { Stat } from "../../ui/stat";
import { ReplayChart } from "./replay-chart";
import "./replay.css";

function price(pns: string): string {
  const whole = BigInt(pns) / 10n;
  const tenth = BigInt(pns) % 10n;
  return `$${whole.toLocaleString("en-US")}.${tenth}`;
}

export const metadata = { title: "A real liquidation" };

export default function ReplayPage() {
  const act = replay.wouldAct;
  return (
    <div className="ui-scope">
      <main className="container replay-page">
        <TourStop page="replay" />
        <header>
          <h1>A real liquidation</h1>
          <p className="replay-sub body-lg">A Bitcoin long liquidated on mainnet, with idle AUSD still in the account.</p>
        </header>
        <Card title="What happened">
          <p>
            Account {replay.accountId} was liquidated at block {replay.liquidationBlock.toLocaleString("en-US")}. The mark was {price(replay.markAtLiquidationPNS)}.
          </p>
          <p>
            <a href={txUrl(MAINNET_ID, replay.tx)}>The liquidation transaction</a>
            {" · "}
            <a href={addressUrl(MAINNET_ID, replay.account)}>The account</a>
          </p>
        </Card>
        <Card title="What the contract said">
          <p>
            A fork at the block before the liquidation asked the exchange to liquidate this position. It emitted {price(replay.forkLiqPricePNS)}. The event's price was {price(replay.eventLiqPricePNS)}. They are the same tick.
          </p>
        </Card>
        <Card title="What Lifeline would have done">
          <ReplayChart
            samples={replay.samples}
            liqPNS={replay.eventLiqPricePNS}
            wouldActBlock={act.block}
            liquidatedBlock={replay.liquidationBlock}
          />
          <p>Lifeline would have acted here, at block {act.block.toLocaleString("en-US")}, {formatPct(act.distanceE6)} from liquidation. The position was liquidated at the end of the chart.</p>
          <div className="replay-stats">
            <Stat label="Margin" value={`${formatAusd(replay.depositCNS)} AUSD`} />
            <Stat label="Idle AUSD beside it" value={`${formatAusd(replay.idleCNS)} AUSD`} />
            <Stat label="Lifeline would have added" value={`${formatAusd(act.amountCNS)} AUSD`} />
          </div>
        </Card>
      </main>
    </div>
  );
}
