package tw.cpblf.source;

import java.util.List;

import tw.cpblf.source.SourceModels.BoxScore;
import tw.cpblf.source.SourceModels.RegistrationSnapshot;
import tw.cpblf.source.SourceModels.SourceGame;

public interface CpblDataSource {

    String name();

    List<SourceGame> fetchSchedule(int year, String kindCode);

    BoxScore fetchBoxScore(int year, String kindCode, int gameSno);

    RegistrationSnapshot fetchRegistration();

    /** 新球員的補充資料（守備位置、國籍）。查無時回傳 null。 */
    SourceModels.SourcePlayer fetchPlayerProfile(String cpblPlayerId);
}
