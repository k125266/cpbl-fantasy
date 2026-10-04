package tw.cpblf.source;

/** 來源回應 404：頁面不存在（例：依序封存時超過最後一場的編號）。仍屬結構例外，未特別處理的呼叫端行為不變。 */
public class SourceNotFoundException extends SourceStructureException {

    public SourceNotFoundException(String message) {
        super(message);
    }
}
