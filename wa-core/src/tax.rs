//! Korea import cost calculator for whisky bought at Whisky Auctioneer.
//!
//! Rules (same as the calculator built on 2026-10-05, sources in README):
//! - Buyer's commission 12.5% of hammer (Whisky Auctioneer buyer fees page). No UK VAT when shipped abroad.
//! - Small-value exemption: ONE bottle, <= 1L, goods <= US$150 -> duty and VAT exempt,
//!   liquor tax and education tax still apply. Two or more bottles -> no exemption.
//! - Taxable value (CIF) = goods + international shipping.
//! - Duty 20% (0% with UK-Korea FTA origin declaration), liquor tax 72% of (CIF + duty),
//!   education tax 30% of liquor tax, VAT 10% of (CIF + duty + liquor + education).
//! - Non-UK/EEA card surcharge 3.5% (optional).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TaxSettings {
    pub commission_rate: f64,
    pub shipping_usd: f64,
    pub card_surcharge: bool,
    pub card_rate: f64,
    pub fta: bool,
    pub usd_limit: f64,
    /// The user's earlier choice: judge the $150 limit on hammer + commission only.
    pub include_shipping_in_limit: bool,
    pub duty_rate: f64,
    pub liquor_rate: f64,
    pub edu_rate: f64,
    pub vat_rate: f64,
}

impl Default for TaxSettings {
    fn default() -> Self {
        Self {
            commission_rate: 0.125,
            shipping_usd: 50.0,
            card_surcharge: false,
            card_rate: 0.035,
            fta: false,
            usd_limit: 150.0,
            include_shipping_in_limit: false,
            duty_rate: 0.20,
            liquor_rate: 0.72,
            edu_rate: 0.30,
            vat_rate: 0.10,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Fx {
    pub gbp_krw: f64,
    pub gbp_usd: f64,
}

impl Fx {
    pub fn usd_krw(&self) -> f64 {
        self.gbp_krw / self.gbp_usd
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalcItem {
    #[serde(default)]
    pub label: Option<String>,
    pub hammer_gbp: f64,
    #[serde(default = "one")]
    pub bottles: u32,
    #[serde(default = "seven_hundred")]
    pub volume_ml: u32,
}

fn one() -> u32 {
    1
}
fn seven_hundred() -> u32 {
    700
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalcResult {
    pub hammer_gbp: f64,
    pub commission_gbp: f64,
    pub goods_gbp: f64,
    pub goods_usd: f64,
    pub goods_krw: f64,
    pub shipping_krw: f64,
    pub cif_krw: f64,
    pub total_bottles: u32,
    pub exempt: bool,
    pub exempt_reason: String,
    pub duty_krw: f64,
    pub liquor_krw: f64,
    pub edu_krw: f64,
    pub vat_krw: f64,
    pub tax_krw: f64,
    pub card_fee_krw: f64,
    pub total_krw: f64,
    pub per_bottle_krw: f64,
    /// Max hammer (GBP) for a single bottle that stays exempt with the current settings.
    pub exempt_hammer_limit_gbp: f64,
}

pub fn calculate(items: &[CalcItem], s: &TaxSettings, fx: &Fx) -> CalcResult {
    let hammer: f64 = items.iter().map(|i| i.hammer_gbp.max(0.0)).sum();
    let commission = hammer * s.commission_rate;
    let goods_gbp = hammer + commission;
    let goods_usd = goods_gbp * fx.gbp_usd;
    let goods_krw = goods_gbp * fx.gbp_krw;
    let shipping_krw = s.shipping_usd * fx.usd_krw();
    let cif = goods_krw + shipping_krw;
    let total_bottles: u32 = items.iter().map(|i| i.bottles.max(1)).sum();
    let max_volume = items.iter().map(|i| i.volume_ml).max().unwrap_or(0);
    let limit_usd = if s.include_shipping_in_limit { goods_usd + s.shipping_usd } else { goods_usd };

    let (exempt, reason) = if items.is_empty() {
        (false, "계산할 품목이 없습니다.".to_string())
    } else if total_bottles != 1 {
        (false, format!("{total_bottles}병이라 관세와 부가세가 붙습니다. 직구 면세는 1병만 해당됩니다."))
    } else if max_volume > 1000 {
        (false, format!("{max_volume}ml로 1L를 넘어 관세와 부가세가 붙습니다."))
    } else if limit_usd > s.usd_limit {
        (false, format!("판정 금액 ${limit_usd:.2}가 한도 ${:.0}를 넘어 관세와 부가세가 붙습니다.", s.usd_limit))
    } else {
        (true, format!("1병, 1L 이하, 판정 금액 ${limit_usd:.2}로 한도 ${:.0} 이내라 관세와 부가세가 면제됩니다.", s.usd_limit))
    };

    let duty = if exempt || s.fta { 0.0 } else { cif * s.duty_rate };
    let liquor = (cif + duty) * s.liquor_rate;
    let edu = liquor * s.edu_rate;
    let vat = if exempt { 0.0 } else { (cif + duty + liquor + edu) * s.vat_rate };
    let tax = duty + liquor + edu + vat;
    let card_fee = if s.card_surcharge { cif * s.card_rate } else { 0.0 };
    let total = cif + tax + card_fee;

    let limit_goods_usd = if s.include_shipping_in_limit { s.usd_limit - s.shipping_usd } else { s.usd_limit };
    let exempt_hammer_limit_gbp = (limit_goods_usd / fx.gbp_usd / (1.0 + s.commission_rate)).max(0.0);

    CalcResult {
        hammer_gbp: hammer,
        commission_gbp: commission,
        goods_gbp,
        goods_usd,
        goods_krw,
        shipping_krw,
        cif_krw: cif,
        total_bottles,
        exempt,
        exempt_reason: reason,
        duty_krw: duty,
        liquor_krw: liquor,
        edu_krw: edu,
        vat_krw: vat,
        tax_krw: tax,
        card_fee_krw: card_fee,
        total_krw: total,
        per_bottle_krw: if total_bottles > 0 { total / total_bottles as f64 } else { 0.0 },
        exempt_hammer_limit_gbp,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(h: f64) -> CalcItem {
        CalcItem { label: None, hammer_gbp: h, bottles: 1, volume_ml: 700 }
    }

    /// Matches the 2026-10-05 calculator: £50, 15% commission, $50 shipping, 1781.69 / 1.3233 -> 328,669 KRW.
    #[test]
    fn single_bottle_exempt_matches_previous_calculator() {
        let s = TaxSettings { commission_rate: 0.15, ..Default::default() };
        let fx = Fx { gbp_krw: 1781.69, gbp_usd: 1.3233 };
        let r = calculate(&[item(50.0)], &s, &fx);
        assert!(r.exempt);
        assert_eq!(r.total_krw.round(), 328_669.0);
        assert!((r.exempt_hammer_limit_gbp - 98.57).abs() < 0.01);
    }

    /// Two £20 bottles, 12.5%, $50, 1769.18 / 1.3347 -> ~372,8xx KRW (answer given on 2026-10-28).
    #[test]
    fn two_bottles_fully_taxed() {
        let s = TaxSettings::default();
        let fx = Fx { gbp_krw: 1769.177961, gbp_usd: 1.334708 };
        let r = calculate(&[item(20.0), item(20.0)], &s, &fx);
        assert!(!r.exempt);
        assert_eq!(r.total_bottles, 2);
        assert!((r.cif_krw - 145_889.0).abs() < 5.0, "cif {}", r.cif_krw);
        assert!((r.tax_krw - 226_933.0).abs() < 10.0, "tax {}", r.tax_krw);
        assert!((r.total_krw - 372_822.0).abs() < 10.0, "total {}", r.total_krw);
        let fta = calculate(&[item(20.0), item(20.0)], &TaxSettings { fta: true, ..s.clone() }, &fx);
        assert!((fta.total_krw - 310_685.0).abs() < 10.0, "fta {}", fta.total_krw);
    }

    #[test]
    fn over_limit_and_volume() {
        let fx = Fx { gbp_krw: 1769.18, gbp_usd: 1.3347 };
        let s = TaxSettings::default();
        assert!(!calculate(&[item(150.0)], &s, &fx).exempt);
        let big = CalcItem { label: None, hammer_gbp: 20.0, bottles: 1, volume_ml: 1750 };
        assert!(!calculate(&[big], &s, &fx).exempt);
        let multi = CalcItem { label: None, hammer_gbp: 20.0, bottles: 4, volume_ml: 700 };
        assert_eq!(calculate(&[multi], &s, &fx).total_bottles, 4);
    }
}
