package tw.cpblf.compliance;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

import tw.cpblf.IntegrationTest;

/** CPBLF-73：schema 不得出現任何幣別、金額、支付、訂單相關欄位或表（規則書 10.1 / 10.5）。 */
class SchemaComplianceTest extends IntegrationTest {

    static final Set<String> FORBIDDEN = Set.of(
            "currency", "price", "payment", "pay", "amount", "fee", "fees", "cash", "money", "wallet", "coin", "coins",
            "balance", "prize", "wager", "bet", "bets", "odds", "order", "orders", "invoice", "subscription", "deposit",
            "refund_amount", "twd", "ntd", "usd", "ad", "ads", "revenue");

    @Test
    void noMoneyRelatedTablesOrColumns() {
        List<String> names = jdbc.sql("""
                select table_name || '.' || column_name from information_schema.columns where table_schema = 'public'
                union select table_name from information_schema.tables where table_schema = 'public'
                """).query(String.class).list();
        assertThat(names).isNotEmpty();
        List<String> offending = names.stream()
                .filter(n -> Arrays.stream(n.toLowerCase().split("[._]")).anyMatch(FORBIDDEN::contains))
                .toList();
        assertThat(offending).isEmpty();
    }

    @Test
    void faabColumnsUseFaabPrefix() {
        List<String> faab = jdbc.sql("""
                select column_name from information_schema.columns where table_schema = 'public' and column_name like '%faab%'
                """).query(String.class).list();
        // 預算 / 出價 / 花費一律 faab_*；refund_faab_on_delist 為布林設定
        assertThat(faab).contains("faab_budget").allMatch(c -> c.startsWith("faab_") || c.equals("refund_faab_on_delist"));
    }
}
