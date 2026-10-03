package tw.cpblf.scoring;

/**
 * 一段期間內的分子分母加總。比率類別一律由加總值計算（規則書 5.4），不得平均每日值。
 * bb 為打者保送，pBb 為投手被保送。
 */
public record StatTotals(
        long ab, long h, long r, long hr, long bb,
        long outs, long er, long pH, long pBb, long k, long sv, long w, long qs) {

    public static final StatTotals ZERO = new StatTotals(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

    public StatTotals plus(StatTotals o) {
        return new StatTotals(ab + o.ab, h + o.h, r + o.r, hr + o.hr, bb + o.bb,
                outs + o.outs, er + o.er, pH + o.pH, pBb + o.pBb, k + o.k, sv + o.sv, w + o.w, qs + o.qs);
    }

    /** 類別值；分母為零時回傳 null（無數據），而非 0。 */
    public Double value(Category c) {
        return switch (c) {
            case R -> (double) r;
            case HR -> (double) hr;
            case H -> (double) h;
            case BB -> (double) bb;
            case AVG -> ab == 0 ? null : (double) h / ab;
            case QS -> (double) qs;
            case K -> (double) k;
            case WSV -> (double) (w + sv);
            case ERA -> outs == 0 ? null : er * 27.0 / outs;
            case WHIP -> outs == 0 ? null : (pH + pBb) * 3.0 / outs;
        };
    }

    public boolean hasData(Category c) {
        return value(c) != null;
    }

    /**
     * 以整數交叉相乘精確比較，避免浮點誤差造成假平手或假勝負。
     * 回傳正數表示 this 較佳，負數表示 other 較佳，0 為平手。雙方皆需有數據。
     */
    public int compare(Category c, StatTotals o) {
        int raw = switch (c) {
            case R -> Long.compare(r, o.r);
            case HR -> Long.compare(hr, o.hr);
            case H -> Long.compare(h, o.h);
            case BB -> Long.compare(bb, o.bb);
            case QS -> Long.compare(qs, o.qs);
            case K -> Long.compare(k, o.k);
            case WSV -> Long.compare(w + sv, o.w + o.sv);
            // h/ab vs o.h/o.ab
            case AVG -> Long.compare(h * o.ab, o.h * ab);
            // er/outs vs o.er/o.outs
            case ERA -> Long.compare(er * o.outs, o.er * outs);
            case WHIP -> Long.compare((pH + pBb) * o.outs, (o.pH + o.pBb) * outs);
        };
        return c.lowerIsBetter ? -raw : raw;
    }

    public String display(Category c) {
        Double v = value(c);
        if (v == null) {
            return "—";
        }
        return switch (c) {
            case AVG -> String.format("%.3f", v).replaceFirst("^0", "");
            case ERA, WHIP -> String.format("%.2f", v);
            default -> String.valueOf(v.longValue());
        };
    }

    public String inningsPitched() {
        return (outs / 3) + "." + (outs % 3);
    }
}
