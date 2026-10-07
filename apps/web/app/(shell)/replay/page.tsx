import replay from "../../../data/mainnet-replay.json";
import { formatPct, formatUsd } from "../../../lib/format";
import { MAINNET_ID, txUrl } from "../../../lib/explorer";

function price(pns: string): string {
  const whole = BigInt(pns) / 10n;
  const tenth = BigInt(pns) % 10n;
  return `$${whole.toLocaleString("en-US")}.${tenth}`;
}

export default function ReplayPage() {
  const act = replay.wouldAct;
  return (
    <main className="stage">
      <h1>A real liquidation</h1>
      <p className="lede">
        Bitcoin long, account {replay.accountId}. Liquidated at block {replay.liquidationBlock.toLocaleString("en-US")}. This page is the stored replay, not a live archive call.
      </p>
      <section className="panel">
        <h2>What the contract did</h2>
        <p>
          At the block before the liquidation, a fork of mainnet asked the exchange to liquidate this position. The price it emitted was {price(replay.forkLiqPricePNS)}. The event's price was {price(replay.eventLiqPricePNS)}. They are the same tick.
        </p>
        <p>
          Mark at liquidation {price(replay.markAtLiquidationPNS)}. Deposit {formatUsd(replay.depositCNS)}. Idle AUSD beside it {formatUsd(replay.idleCNS)}.
        </p>
        <p>
          <a href={txUrl(MAINNET_ID, replay.tx)}>Liquidation transaction</a>
        </p>
      </section>
      <section className="panel">
        <h2>What Lifeline would have done</h2>
        <p>
          Sampled {replay.samples.length} marks from block {replay.samples[0]?.block.toLocaleString("en-US")}. The first sample already inside the 4% trigger is block {act.block.toLocaleString("en-US")}, at {formatPct(act.distanceE6)} from liquidation. Lifeline would have added {formatUsd(act.amountCNS)} from the idle balance, the whole amount that was sitting there.
        </p>
        <p>Account {replay.account}.</p>
      </section>
    </main>
  );
}
