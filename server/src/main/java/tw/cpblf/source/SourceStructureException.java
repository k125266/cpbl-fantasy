package tw.cpblf.source;

/** 回傳結構與預期不符（欄位消失、格式改變）。需人工確認，不得靜默略過。 */
public class SourceStructureException extends RuntimeException {
    public SourceStructureException(String message) {
        super(message);
    }
}
