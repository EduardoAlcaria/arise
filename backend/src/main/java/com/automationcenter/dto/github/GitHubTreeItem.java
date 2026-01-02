package com.automationcenter.dto.github;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class GitHubTreeItem {
    private String path;
    private String type;
    private Long size;
}
