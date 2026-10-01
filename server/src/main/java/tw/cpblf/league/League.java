package tw.cpblf.league;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.EnumMap;
import java.util.Map;

import tw.cpblf.roster.Slot;

/** 聯盟設定。所有規則書中可能調整的數字都在這裡，不寫死於程式碼。 */
public record League(
        long id,
        String name,
        int seasonYear,
        String inviteCode,
        long commissionerUserId,
        int maxTeams,
        int foreignPlayerLimit,
        int positionMinGames,
        int spMinStarts,
        int eligibilityGraceDays,
        int faabBudgetPerHalf,
        int slotsIf, int slotsOf, int slotsUtil, int slotsSp, int slotsRp, int slotsBench, int slotsNa,
        int minorsReturnDays,
        int foreignMinorsReturnDays,
        int hitterIdleGameDays,
        int pitcherIdleDays,
        int waiverDays,
        int waiverProcessHour,
        int tradeReviewHours,
        int matchupLockHours,
        int keeperLimit,
        int keeperRoundOffset,
        int draftRounds,
        int draftPickSeconds,
        boolean refundFaabOnDelist,
        Long championTeamId,
        String championNote) {

    public static League from(ResultSet rs) throws SQLException {
        long champ = rs.getLong("champion_team_id");
        Long championTeamId = rs.wasNull() ? null : champ;
        return new League(
                rs.getLong("id"), rs.getString("name"), rs.getInt("season_year"), rs.getString("invite_code"),
                rs.getLong("commissioner_user_id"), rs.getInt("max_teams"), rs.getInt("foreign_player_limit"),
                rs.getInt("position_min_games"), rs.getInt("sp_min_starts"), rs.getInt("eligibility_grace_days"),
                rs.getInt("faab_budget_per_half"),
                rs.getInt("slots_if"), rs.getInt("slots_of"), rs.getInt("slots_util"), rs.getInt("slots_sp"),
                rs.getInt("slots_rp"), rs.getInt("slots_bench"), rs.getInt("slots_na"),
                rs.getInt("minors_return_days"), rs.getInt("foreign_minors_return_days"),
                rs.getInt("hitter_idle_game_days"), rs.getInt("pitcher_idle_days"),
                rs.getInt("waiver_days"), rs.getInt("waiver_process_hour"), rs.getInt("trade_review_hours"),
                rs.getInt("matchup_lock_hours"), rs.getInt("keeper_limit"), rs.getInt("keeper_round_offset"),
                rs.getInt("draft_rounds"), rs.getInt("draft_pick_seconds"), rs.getBoolean("refund_faab_on_delist"),
                championTeamId, rs.getString("champion_note"));
    }

    /** 各 slot 名額。 */
    public Map<Slot, Integer> slotCounts() {
        Map<Slot, Integer> m = new EnumMap<>(Slot.class);
        m.put(Slot.IF, slotsIf);
        m.put(Slot.OF, slotsOf);
        m.put(Slot.UTIL, slotsUtil);
        m.put(Slot.SP, slotsSp);
        m.put(Slot.RP, slotsRp);
        m.put(Slot.BN, slotsBench);
        m.put(Slot.NA, slotsNa);
        return m;
    }

    public int startingSlotCount() {
        return slotsIf + slotsOf + slotsUtil + slotsSp + slotsRp;
    }

    /** Roster 額度（不含 NA）。 */
    public int rosterSize() {
        return startingSlotCount() + slotsBench;
    }
}
