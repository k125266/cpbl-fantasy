package tw.cpblf.scoring;

/** 規則書第 5 節：打者 5 項 + 投手 5 項。 */
public enum Category {
    R("R", "得分", false, false),
    HR("HR", "全壘打", false, false),
    RBI("RBI", "打點", false, false),
    SB("SB", "盜壘", false, false),
    AVG("AVG", "打擊率", false, true),
    QS("QS", "優質先發", false, false),
    K("K", "三振", false, false),
    SVHLD("SV+HLD", "救援+中繼", false, false),
    ERA("ERA", "防禦率", true, true),
    WHIP("WHIP", "每局被上壘率", true, true);

    public final String label;
    public final String zhLabel;
    public final boolean lowerIsBetter;
    public final boolean ratio;

    Category(String label, String zhLabel, boolean lowerIsBetter, boolean ratio) {
        this.label = label;
        this.zhLabel = zhLabel;
        this.lowerIsBetter = lowerIsBetter;
        this.ratio = ratio;
    }
}
