// TypeScript port of wa-core/src/tax.rs for the web test build (same rules, same field names).
import type { CalcItem, CalcResult, FxRecord, TaxSettings } from "../api";

export const DEFAULT_TAX: TaxSettings = {
  commissionRate: 0.125,
  shippingUsd: 50,
  cardSurcharge: false,
  cardRate: 0.035,
  fta: false,
  usdLimit: 150,
  includeShippingInLimit: false,
  dutyRate: 0.2,
  liquorRate: 0.72,
  eduRate: 0.3,
  vatRate: 0.1,
};

export function calculate(items: CalcItem[], s: TaxSettings, fx: Pick<FxRecord, "gbpKrw" | "gbpUsd">): CalcResult {
  const hammer = items.reduce((a, i) => a + Math.max(0, i.hammerGbp), 0);
  const commission = hammer * s.commissionRate;
  const goodsGbp = hammer + commission;
  const goodsUsd = goodsGbp * fx.gbpUsd;
  const goodsKrw = goodsGbp * fx.gbpKrw;
  const shippingKrw = s.shippingUsd * (fx.gbpKrw / fx.gbpUsd);
  const cif = goodsKrw + shippingKrw;
  const totalBottles = items.reduce((a, i) => a + Math.max(1, i.bottles), 0);
  const maxVolume = items.reduce((a, i) => Math.max(a, i.volumeMl), 0);
  const limitUsd = s.includeShippingInLimit ? goodsUsd + s.shippingUsd : goodsUsd;

  let exempt = false;
  let reason: string;
  if (items.length === 0) reason = "계산할 품목이 없습니다.";
  else if (totalBottles !== 1) reason = `${totalBottles}병이라 관세와 부가세가 붙습니다. 직구 면세는 1병만 해당됩니다.`;
  else if (maxVolume > 1000) reason = `${maxVolume}ml로 1L를 넘어 관세와 부가세가 붙습니다.`;
  else if (limitUsd > s.usdLimit) reason = `판정 금액 $${limitUsd.toFixed(2)}가 한도 $${s.usdLimit.toFixed(0)}를 넘어 관세와 부가세가 붙습니다.`;
  else {
    exempt = true;
    reason = `1병, 1L 이하, 판정 금액 $${limitUsd.toFixed(2)}로 한도 $${s.usdLimit.toFixed(0)} 이내라 관세와 부가세가 면제됩니다.`;
  }

  const duty = exempt || s.fta ? 0 : cif * s.dutyRate;
  const liquor = (cif + duty) * s.liquorRate;
  const edu = liquor * s.eduRate;
  const vat = exempt ? 0 : (cif + duty + liquor + edu) * s.vatRate;
  const tax = duty + liquor + edu + vat;
  const cardFee = s.cardSurcharge ? cif * s.cardRate : 0;
  const total = cif + tax + cardFee;
  const limitGoodsUsd = s.includeShippingInLimit ? s.usdLimit - s.shippingUsd : s.usdLimit;

  return {
    hammerGbp: hammer,
    commissionGbp: commission,
    goodsGbp,
    goodsUsd,
    goodsKrw,
    shippingKrw,
    cifKrw: cif,
    totalBottles,
    exempt,
    exemptReason: reason,
    dutyKrw: duty,
    liquorKrw: liquor,
    eduKrw: edu,
    vatKrw: vat,
    taxKrw: tax,
    cardFeeKrw: cardFee,
    totalKrw: total,
    perBottleKrw: totalBottles > 0 ? total / totalBottles : 0,
    exemptHammerLimitGbp: Math.max(0, limitGoodsUsd / fx.gbpUsd / (1 + s.commissionRate)),
  };
}
