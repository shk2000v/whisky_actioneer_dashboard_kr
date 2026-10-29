import { useEffect, useState } from "react";
import { api, canRun, type MyBid } from "./api";

/** Open bids from the last site-account sync, keyed by lot entity id. Empty when not logged in. */
export function useMyBids(reloadKey = 0): Map<number, MyBid> {
  const [bids, setBids] = useState<Map<number, MyBid>>(() => new Map());
  useEffect(() => {
    if (!canRun()) return;
    api
      .account()
      .then((a) => setBids(new Map((a?.bids ?? []).map((b) => [b.entityId, b]))))
      .catch(() => {});
  }, [reloadKey]);
  return bids;
}

export const bidLabel = (b: MyBid) => (b.winning ? (b.metReserve ? "최고가" : "최고가, reserve 미달") : "추월당함");
