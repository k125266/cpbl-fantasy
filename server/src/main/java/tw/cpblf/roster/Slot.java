package tw.cpblf.roster;

public enum Slot {
    IF, OF, UTIL, SP, RP, BN, NA;

    public boolean isStarting() {
        return this != BN && this != NA;
    }

    public boolean isHitting() {
        return this == IF || this == OF || this == UTIL;
    }

    public boolean isPitching() {
        return this == SP || this == RP;
    }

    public static final Slot[] STARTING = {IF, OF, UTIL, SP, RP};
}
